const { Router } = require('express')
const { cacheMiddleware: cache } = require('../middleware/cache')
const asyncHandler = require('../middleware/asyncHandler')
const sc = require('../services/soundcloud')
const lunexSc = require('../utils/lunex-sc')

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

  const targetUrl = url || `https://api.soundcloud.com/tracks/${id}`

  const pm = require('../middleware/proxyManager')

  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    const proxyObj = pm.getCountryAwareProxyAgent('soundcloud')
    const proxyUrl = proxyObj ? proxyObj.url : null

    try {
      // Extract stream URL using mobile-spoofing SoundCloud extractor with dynamic client_id rotation
      const extraction = await lunexSc.extractTrackStream(targetUrl, { proxy: proxyUrl })
      const foundUrl = extraction.streamUrl

      if (!foundUrl) throw new Error('No valid stream URL extracted')

      if (proxyUrl) pm.markProxySuccess(proxyUrl)
      console.log(`[SoundCloud] Stream OK (${extraction.format}, ${extraction.bitrate}) for ${id || url}`)

      const reqHeaders = {
        'User-Agent': 'SoundCloud/2024.05.01-release (Android 14; Mobile; arm64-v8a)',
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
        return
      } else {
        throw new Error('SC Stream body is empty')
      }

    } catch (err) {
      if (proxyUrl) pm.markProxyFailed(proxyUrl)
      console.warn(`[SoundCloud] Stream attempt ${attempt} failed:`, err.message)
      lastError = err
    }
  }

  throw lastError || new Error('All SoundCloud stream attempts failed')
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
