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

router.get('/stream', asyncHandler(async (req) => {
  let { url, id } = req.query
  if (!url && !id) throw new Error('Stream URL or track ID required')

  if (id) {
    try {
      const trackRes = await sc.requestFull(`/tracks/${id}`)
      const trackData = trackRes.data
      const originalAgent = trackRes.config._proxyAgent
      const authParam = trackData.track_authorization
      
      const unencrypted = trackData?.media?.transcodings?.filter(t => t.format.protocol === 'progressive' || t.format.protocol === 'hls') || []
      
      const tcPromises = unencrypted.map(tc => {
        // Делаем 1 попытку вместо 3, так как мы запускаем их параллельно
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

      if (foundUrl) return foundUrl
      throw new Error('No valid stream found for track')
    } catch (err) {
      console.error('[SoundCloud] Stream resolve error:', err.message)
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
      if (data && data.url) return data.url
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
