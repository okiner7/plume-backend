const { Router } = require('express')
const asyncHandler = require('../middleware/asyncHandler')
const yt = require('../services/youtube')
const { cacheMiddleware: cache, getStreamCache, setStreamCache, deleteStreamCache } = require('../middleware/cache')
const crypto = require('crypto')
const { ProxyAgent } = require('undici')
const { Readable } = require('stream')
const fs = require('fs')
const path = require('path')
const lunexYtdl = require('../utils/lunex-ytdl')

// LNX-2026-034: Убран небезопасный fallback — сервер упадёт при старте если LUNEX_APP_SECRET не задан
if (!process.env.LUNEX_APP_SECRET) throw new Error('[Plume] Отсутствует обязательная переменная среды: LUNEX_APP_SECRET')
const APP_SECRET = process.env.LUNEX_APP_SECRET

const router = Router()


router.get('/stream', asyncHandler(async (req, res) => {
  const { id, t, sig } = req.query
  if (!id) throw new Error('Video ID required')
  if (!t || !sig) {
    res.status(403).json({ success: false, error: 'Auth required' })
    return
  }

  const expectedSig = crypto.createHmac('sha256', APP_SECRET)
                            .update('/api/yt/stream' + t)
                            .digest('hex')
  if (sig !== expectedSig) {
    res.status(403).json({ success: false, error: 'Invalid signature' })
    return
  }

  // Prevent replay attacks / eternal links (max 60 seconds diff)
  if (Math.abs(Date.now() - parseInt(t, 10)) > 60000) {
    res.status(403).json({ success: false, error: 'Stream link expired' })
    return
  }

  const cacheKey = `yt_${id}`
  let cachedData = await getStreamCache(cacheKey)
  let streamUrl = null
  let audioBitrate = '256'
  let audioCodec = 'aac'

  if (cachedData) {
    try {
      const parsed = typeof cachedData === 'string' ? JSON.parse(cachedData) : cachedData
      if (parsed && parsed.url) {
        streamUrl = parsed.url
        audioBitrate = String(parsed.bitrate || '256')
        audioCodec = String(parsed.codec || 'aac')
      } else if (typeof cachedData === 'string') {
        streamUrl = cachedData
      }
    } catch (e) {
      streamUrl = typeof cachedData === 'string' ? cachedData : null
    }
  }

  let streamRes

  for (let fetchAttempt = 1; fetchAttempt <= 2; fetchAttempt++) {
    if (!streamUrl) {
      const pm = require('../middleware/proxyManager')

      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const proxyObj = pm.getCountryAwareProxyAgent('youtube')
        const proxyUrl = proxyObj ? proxyObj.url : null
        
        try {
          // 1. Extract URL with lunex-ytdl
          const extraction = await lunexYtdl.getStreamUrl(id, { proxy: proxyUrl, returnObject: true })
          const rawUrl = typeof extraction === 'string' ? extraction : extraction.url
          const rawBitrate = typeof extraction === 'object' && extraction.bitrate ? extraction.bitrate : 256000
          const rawCodec = typeof extraction === 'object' && extraction.codec ? extraction.codec : 'aac'

          streamUrl = rawUrl
          audioBitrate = String(rawBitrate >= 1000 ? Math.round(rawBitrate / 1000) : rawBitrate)
          audioCodec = rawCodec.includes('opus') ? 'opus' : (rawCodec.includes('mp3') ? 'mp3' : 'aac')

          if (proxyUrl) pm.markProxySuccess(proxyUrl)
          console.log(`[YouTube] Stream OK (${audioCodec}, ${audioBitrate}k) for ${id}`)
          await setStreamCache(cacheKey, JSON.stringify({ url: streamUrl, bitrate: audioBitrate, codec: audioCodec }), 900) // Cache stream URL for 15 minutes
          break

        } catch (err) {
          if (proxyUrl) pm.markProxyFailed(proxyUrl)
          console.warn(`[YouTube] Stream attempt ${attempt} failed (proxy: ${proxyUrl || 'none'}):`, err.message)
          lastError = err
        }
      }

      if (!streamUrl) throw lastError || new Error('All YouTube stream attempts failed')
    } else {
      if (fetchAttempt === 1) console.log(`[YouTube] Stream Cache HIT for ${id}`)
    }

    // 2. Fetch CDN stream directly (googlevideo.com is globally accessible)
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*'
    }
    if (req.headers.range) {
      reqHeaders['Range'] = req.headers.range
    }

    streamRes = await fetch(streamUrl, { headers: reqHeaders })
    
    if (!streamRes.ok && streamRes.status !== 206) {
      if (streamRes.status === 403) {
        console.warn(`[YouTube] 403 Forbidden from CDN, invalidating cache and retrying...`)
        await deleteStreamCache(cacheKey)
        streamUrl = null // Force extraction on next attempt
        continue
      }
      throw new Error(`Failed to fetch media stream: ${streamRes.statusText}`)
    }
    
    break // success
  }
      

  const statusCode = streamRes.status || 200
  res.status(statusCode)
  res.setHeader('Content-Type', streamRes.headers.get('content-type') || 'audio/mp4')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('X-Audio-Bitrate', audioBitrate)
  res.setHeader('X-Audio-Codec', audioCodec)
  if (streamRes.headers.get('content-length')) {
    res.setHeader('Content-Length', streamRes.headers.get('content-length'))
  }
  if (streamRes.headers.get('content-range')) {
    res.setHeader('Content-Range', streamRes.headers.get('content-range'))
  }

  if (req.method === 'HEAD') {
    res.end()
    return
  }
  
  if (streamRes.body) {
    const nodeStream = typeof streamRes.body.pipe === 'function'
      ? streamRes.body
      : Readable.fromWeb(streamRes.body)

    res.on('close', () => {
      if (typeof nodeStream.destroy === 'function') nodeStream.destroy()
    })
    nodeStream.on('error', () => {})

    nodeStream.pipe(res)
    return // success
  } else {
    throw new Error('Stream body is empty')
  }
}))


router.get('/search', cache(7200), asyncHandler(async (req) => {
  const { q } = req.query
  if (!q) throw new Error('Query required')
  return await yt.search(q)
}))

router.get('/proxy', asyncHandler(async (req) => {
  const pm = require('../middleware/proxyManager')
  // Request a fast proxy specifically targeted for youtube
  const proxyObj = pm.getCountryAwareProxyAgent('youtube')
  if (proxyObj && proxyObj.url) {
    return { success: true, proxy: proxyObj.url }
  }
  return { success: false, proxy: null }
}))

router.get('/search-artists', cache(7200), asyncHandler(async (req) => {
  const { q } = req.query
  if (!q) throw new Error('Query required')
  return await yt.searchArtists(q)
}))

router.get('/search-albums', cache(7200), asyncHandler(async (req) => {
  const { q } = req.query
  if (!q) throw new Error('Query required')
  return await yt.searchAlbums(q)
}))

router.get('/search-playlists', cache(7200), asyncHandler(async (req) => {
  const { q } = req.query
  if (!q) throw new Error('Query required')
  return await yt.searchPlaylists(q)
}))


router.get('/artist', cache(21600), asyncHandler(async (req) => {
  const { id } = req.query
  if (!id) throw new Error('Artist ID required')
  return await yt.getArtist(id)
}))

router.get('/artist-full', cache(21600), asyncHandler(async (req) => {
  const { id } = req.query
  if (!id) throw new Error('Artist ID required')
  return await yt.getArtistFull(id)
}))

router.get('/artist-songs', cache(21600), asyncHandler(async (req) => {
  const { id } = req.query
  if (!id) throw new Error('Artist ID required')
  return await yt.getArtistSongs(id)
}))

router.get('/playlist', cache(3600), asyncHandler(async (req) => {
  const { id } = req.query
  if (!id) throw new Error('Playlist ID required')
  return await yt.getPlaylist(id)
}))

router.get('/playlist-tracks', cache(3600), asyncHandler(async (req) => {
  const { id } = req.query
  if (!id) throw new Error('Playlist ID required')
  return await yt.getPlaylistTracks(id)
}))

router.get('/album', cache(21600), asyncHandler(async (req) => {
  const { id } = req.query
  if (!id) throw new Error('Album ID required')
  return await yt.getAlbum(id)
}))

router.get('/album-tracks', cache(21600), asyncHandler(async (req) => {
  const { id } = req.query
  if (!id) throw new Error('Album ID required')
  return await yt.getAlbumTracks(id)
}))

router.get('/upnext', asyncHandler(async (req) => {
  const { id, history } = req.query
  if (!id) throw new Error('Video ID required')
  // LNX-2026-027: cap history list to 50 IDs to prevent DoS via huge payload
  const historyIds = history ? history.split(',').filter(Boolean).slice(0, 50) : []
  return await yt.getUpNexts(id, historyIds)
}))

module.exports = router
