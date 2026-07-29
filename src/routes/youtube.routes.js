const { Router } = require('express')
const asyncHandler = require('../middleware/asyncHandler')
const yt = require('../services/youtube')
const { cacheMiddleware: cache } = require('../middleware/cache')
const crypto = require('crypto')
const { Innertube, UniversalCache } = require('youtubei.js')
const { ProxyAgent } = require('undici')
const { Readable } = require('stream')

const APP_SECRET = process.env.LUNEX_APP_SECRET || 'super-secret-lunex-app-key-2026'

const router = Router()

router.get('/stream', asyncHandler(async (req, res) => {
  const { id, t, sig } = req.query
  if (!id) throw new Error('Video ID required')
  if (!t || !sig) return res.status(403).json({ error: 'Auth required' })

  const expectedSig = crypto.createHmac('sha256', APP_SECRET)
                            .update('/api/yt/stream' + t)
                            .digest('hex')
  if (sig !== expectedSig) {
    return res.status(403).json({ error: 'Invalid signature' })
  }

  const pm = require('../middleware/proxyManager')
  const proxyObj = pm.getCountryAwareProxyAgent('youtube')
  let proxyUrl = proxyObj ? proxyObj.url : null

  let fetchFn = fetch
  if (proxyUrl) {
    const dispatcher = new ProxyAgent(proxyUrl)
    fetchFn = async (input, init = {}) => {
      return fetch(input, { ...init, dispatcher })
    }
  }

  const youtube = await Innertube.create({
    cache: new UniversalCache(false),
    fetch: fetchFn
  })

  const info = await youtube.getBasicInfo(id)
  const format = info.chooseFormat({ type: 'audio', quality: 'best' })

  if (!format) {
    throw new Error('No audio format found')
  }

  let streamUrl;
  try {
    const decipherRes = format.decipher(youtube.session.player);
    if (decipherRes instanceof Promise) await decipherRes;
    streamUrl = format.url;
  } catch (e) {
    streamUrl = format.url;
  }

  if (!streamUrl) throw new Error('No stream URL')

  const streamRes = await fetch(streamUrl, {
    dispatcher: proxyUrl ? new ProxyAgent(proxyUrl) : undefined,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  })
  
  if (!streamRes.ok) {
    throw new Error(`Failed to fetch media stream: ${streamRes.statusText}`)
  }

  res.setHeader('Content-Type', format.mime_type || 'audio/mp4')
  res.setHeader('Accept-Ranges', 'bytes')
  if (streamRes.headers.get('content-length')) {
    res.setHeader('Content-Length', streamRes.headers.get('content-length'))
  }
  
  if (streamRes.body) {
    const nodeStream = Readable.fromWeb(streamRes.body)
    nodeStream.pipe(res)
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
