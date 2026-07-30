const { Router } = require('express')
const { cacheMiddleware: cache } = require('../middleware/cache')
const asyncHandler = require('../middleware/asyncHandler')
const sc = require('../services/soundcloud')

const router = Router()

router.get('/search', cache(7200), asyncHandler(async (req) => {
  const { q } = req.query
  if (!q) throw new Error('Query required')
  return await sc.search(q)
}))

router.get('/search/users', cache(7200), asyncHandler(async (req) => {
  const { q } = req.query
  if (!q) throw new Error('Query required')
  return await sc.searchUsers(q)
}))

router.get('/search/playlists', cache(7200), asyncHandler(async (req) => {
  const { q } = req.query
  if (!q) throw new Error('Query required')
  return await sc.searchPlaylists(q)
}))

router.get('/stream', asyncHandler(async (req, res) => {
  let { url, id } = req.query
  if (!url && !id) throw new Error('Stream URL or track ID required')

  if (id) {
    try {
      const trackRes = await sc.requestFull(`/tracks/${id}`)
    const trackData = trackRes.data
      const originalAgent = trackRes.config._proxyAgent
      const authParam = trackData.track_authorization
      
      // Нам нужен только progressive (цельный файл), так как HLS-плейлисты проксировать сложнее
      const unencrypted = trackData?.media?.transcodings?.filter(t => t.format.protocol === 'progressive') || []
      
      if (unencrypted.length === 0) {
        throw new Error('No progressive stream found for track')
      }

      const tcPromises = unencrypted.map(tc => {
        return sc.request(tc.url, authParam ? { track_authorization: authParam } : {}, 1, originalAgent)
          .then(tcRes => {
             if (tcRes && tcRes.url) return tcRes.url;
             throw new Error('No URL returned');
          });
      });

      let foundUrl = null;
      if (tcPromises.length > 0) {
        try {
          foundUrl = await Promise.any(tcPromises);
        } catch (e) {
          console.warn(`[SoundCloud] All transcode requests failed for track ${id}`);
        }
      }

      if (!foundUrl) throw new Error('No valid stream found for track')

      // Проксируем поток клиенту, чтобы обойти блокировки SC в РФ
      const reqHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      }
      if (req.headers.range) {
        reqHeaders['Range'] = req.headers.range
      }

      const streamRes = await fetch(foundUrl, { headers: reqHeaders })
      
      if (!streamRes.ok && streamRes.status !== 206) {
        throw new Error(`Failed to fetch SC stream: ${streamRes.statusText}`)
      }

      const statusCode = streamRes.status || 200
      res.status(statusCode)
      res.setHeader('Content-Type', streamRes.headers.get('content-type') || 'audio/mpeg')
      res.setHeader('Accept-Ranges', 'bytes')
      if (streamRes.headers.get('content-length')) {
        res.setHeader('Content-Length', streamRes.headers.get('content-length'))
      }
      if (streamRes.headers.get('content-range')) {
        res.setHeader('Content-Range', streamRes.headers.get('content-range'))
      }
      
      if (streamRes.body) {
        const { Readable } = require('stream')
        const nodeStream = typeof streamRes.body.pipe === 'function'
          ? streamRes.body
          : Readable.fromWeb(streamRes.body)
        nodeStream.pipe(res)
        return // Успешное проксирование
      } else {
        throw new Error('SC Stream body is empty')
      }

    } catch (err) {
      console.error('[SoundCloud] Stream resolve error:', err.message)
      throw err
    }
  }

  // Fallback for when only url is provided (should rarely happen now)
  try {
    if (url) {
      // FIX SSRF: restrict fallback URL to SoundCloud domains
      const safeUrl = String(url)
      let parsedUrl;
      try {
        parsedUrl = new URL(safeUrl)
      } catch (e) {
        throw new Error('Invalid URL format')
      }
      
      if (parsedUrl.hostname !== 'api-v2.soundcloud.com' && parsedUrl.hostname !== 'soundcloud.com') {
        throw new Error('Invalid SoundCloud URL')
      }
      const data = await sc.request(safeUrl)
      if (data && data.url) {
        const streamRes = await fetch(data.url)
        if (!streamRes.ok) throw new Error('Failed to fetch SC stream fallback')
        res.setHeader('Content-Type', streamRes.headers.get('content-type') || 'audio/mpeg')
        if (streamRes.body) {
          const { Readable } = require('stream')
          const nodeStream = typeof streamRes.body.pipe === 'function' ? streamRes.body : Readable.fromWeb(streamRes.body)
          nodeStream.pipe(res)
          return
        }
      }
    }
  } catch (err) {
    throw err
  }
  throw new Error('Failed to extract media URL')
}))

router.get('/user', cache(21600), asyncHandler(async (req) => {
  const { url } = req.query
  if (!url) throw new Error('URL required')
  return await sc.getUserInfo(url)
}))

router.get('/user-by-id', cache(21600), asyncHandler(async (req) => {
  const { id } = req.query
  if (!id) throw new Error('User ID required')
  return await sc.getUserById(id)
}))

router.get('/user-by-id/tracks', cache(21600), asyncHandler(async (req) => {
  const { id } = req.query
  if (!id) throw new Error('User ID required')
  return await sc.getUserTracksById(id)
}))

router.get('/user-by-id/playlists', cache(21600), asyncHandler(async (req) => {
  const { id } = req.query
  if (!id) throw new Error('User ID required')
  return await sc.getUserPlaylistsById(id)
}))

router.get('/playlist-tracks', cache(3600), asyncHandler(async (req) => {
  const { id } = req.query
  if (!id) throw new Error('Playlist ID or URL required')
  return await sc.getPlaylistTracks(id)
}))

router.get('/likes', cache(3600), asyncHandler(async (req) => {
  const { url } = req.query
  if (!url) throw new Error('URL required')
  return await sc.getUserLikes(url)
}))

router.get('/playlists', cache(21600), asyncHandler(async (req) => {
  const { url } = req.query
  if (!url) throw new Error('URL required')
  return await sc.getUserPlaylists(url)
}))

router.get('/related', cache(3600), asyncHandler(async (req) => {
  const { id } = req.query
  if (!id) throw new Error('Track ID required')
  return await sc.getRelatedTracks(id)
}))

router.get('/artist-tracks', cache(3600), asyncHandler(async (req) => {
  const { artist } = req.query
  if (!artist) throw new Error('Artist name required')
  return await sc.searchTracksByArtist(artist, 20)
}))

module.exports = router
