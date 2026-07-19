const { Router } = require('express')
const { cacheMiddleware: cache } = require('../src/middleware/cache')
const asyncHandler = require('../src/middleware/asyncHandler')
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
      const trackData = await sc.request(`/tracks/${id}`)
      const authParam = trackData.track_authorization
      
      const unencrypted = trackData?.media?.transcodings?.filter(t => t.format.protocol === 'progressive' || t.format.protocol === 'hls') || []
      
      let foundUrl = null
      for (const tc of unencrypted) {
        try {
           const tcRes = await sc.request(tc.url, authParam ? { track_authorization: authParam } : {})
           if (tcRes && tcRes.url) {
             foundUrl = tcRes.url
             break
           }
        } catch (e) {
           console.warn(`[SoundCloud] Failed to fetch transcoding URL: ${tc.url}`, e.message)
        }
      }

  if (foundUrl) return foundUrl
  throw new Error('No valid stream found for track')
  }

  // Fallback for when only url is provided (should rarely happen now)
  try {
    if (url) {
      // FIX SSRF: restrict fallback URL to SoundCloud domains
      const safeUrl = String(url)
      if (!safeUrl.startsWith('https://api-v2.soundcloud.com/') && !safeUrl.startsWith('https://soundcloud.com/')) {
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
