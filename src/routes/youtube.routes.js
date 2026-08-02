const { Router } = require('express')
const asyncHandler = require('../middleware/asyncHandler')
const yt = require('../services/youtube')
const { cacheMiddleware: cache } = require('../middleware/cache')
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

  const pm = require('../middleware/proxyManager')

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const proxyObj = pm.getCountryAwareProxyAgent('youtube')
    const proxyUrl = proxyObj ? proxyObj.url : null
    
    try {
      // 1. Extract URL with lunex-ytdl
      const streamUrl = await lunexYtdl.getStreamUrl(id, { proxy: proxyUrl })

      // 2. Fetch CDN stream directly (googlevideo.com is globally accessible)
      const reqHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      }
      if (req.headers.range) {
        reqHeaders['Range'] = req.headers.range
      }

      const streamRes = await fetch(streamUrl, { headers: reqHeaders })
      
      if (!streamRes.ok && streamRes.status !== 206) {
        if (streamRes.status === 403) throw new Error('403 Forbidden from Googlevideo')
        throw new Error(`Failed to fetch media stream: ${streamRes.statusText}`)
      }

      if (proxyUrl) pm.markProxySuccess(proxyUrl)
      console.log(`[YouTube] Stream OK for ${id}`)

      const statusCode = streamRes.status || 200
      res.status(statusCode)
      res.setHeader('Content-Type', streamRes.headers.get('content-type') || 'audio/mp4')
      res.setHeader('Accept-Ranges', 'bytes')
      if (streamRes.headers.get('content-length')) {
        res.setHeader('Content-Length', streamRes.headers.get('content-length'))
      }
      if (streamRes.headers.get('content-range')) {
        res.setHeader('Content-Range', streamRes.headers.get('content-range'))
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

    } catch (err) {
      if (proxyUrl) pm.markProxyFailed(proxyUrl)
      console.warn(`[YouTube] Stream attempt ${attempt} failed (proxy: ${proxyUrl || 'none'}):`, err.message)
      lastError = err
    }
  }

  throw lastError || new Error('All attempts failed')
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
