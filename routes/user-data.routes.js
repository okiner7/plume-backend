const { Router } = require('express')
const asyncHandler = require('../src/middleware/asyncHandler')
const authRequired = require('../src/middleware/authRequired')
const likesStore = require('../services/storage/likesStore')
const playlistsStore = require('../services/storage/playlistsStore')
const settingsStore = require('../services/storage/settingsStore')
const searchHistoryStore = require('../services/storage/searchHistoryStore')
const listeningHistoryStore = require('../services/storage/listeningHistoryStore')
const userStore = require('../services/storage/userStore')

const router = Router()

router.use(authRequired)

function isValidArtworkUrl(url) {
  if (!url) return false
  try {
    const u = new URL(url)
    return ['https:', 'http:'].includes(u.protocol)
  } catch { return false }
}

function sanitizeTrack(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('Invalid track format')
  return {
    id: String(t.id || '').slice(0, 100),
    source: String(t.source || '').slice(0, 50),
    title: String(t.title || '').slice(0, 200),
    artist: String(t.artist || '').slice(0, 200),
    duration: Number(t.duration) || 0,
    artwork: isValidArtworkUrl(t.artwork) ? String(t.artwork).slice(0, 1000) : '',
    url: String(t.url || '').slice(0, 1000)
  }
}

function getUserId(req) {
  return `${req.user.provider}_${req.user.provider_id}`
}

function getProviderId(req) {
  return req.user.provider_id
}

// --- Likes ---

router.get('/likes', asyncHandler(async (req) => {
  const userId = getUserId(req)
  return await likesStore.getAll(userId)
}))

router.post('/likes', asyncHandler(async (req) => {
  const userId = getUserId(req)
  const providerId = getProviderId(req)
  const track = sanitizeTrack(req.body.track)
  return await likesStore.add(userId, track, providerId)
}))

router.delete('/likes', asyncHandler(async (req) => {
  const userId = getUserId(req)
  // FIX NoSQL Injection: strictly cast to string to prevent object injection like {"$ne": null}
  const trackId = String(req.body.trackId || '')
  const source = String(req.body.source || '')
  if (!trackId || !source) throw new Error('trackId and source required')
  await likesStore.removeByTrack(userId, trackId, source)
  return { success: true }
}))

// --- Playlists ---

router.get('/playlists', asyncHandler(async (req) => {
  const ownerId = getUserId(req)
  return await playlistsStore.getAll(ownerId)
}))

router.post('/playlists', asyncHandler(async (req) => {
  const ownerId = getUserId(req)
  const name = String(req.body.name || '').trim().slice(0, 100)
  if (!name) throw new Error('Name required')
  return await playlistsStore.create(ownerId, name)
}))

router.put('/playlists/:id', asyncHandler(async (req) => {
  const ownerId = getUserId(req)
  const name = String(req.body.name || '').trim().slice(0, 100)
  if (!name) throw new Error('Name required')
  await playlistsStore.rename(req.params.id, ownerId, name)
  return { success: true }
}))

router.delete('/playlists/:id', asyncHandler(async (req) => {
  const ownerId = getUserId(req)
  await playlistsStore.remove(req.params.id, ownerId)
  return { success: true }
}))

router.post('/playlists/:id/tracks', asyncHandler(async (req) => {
  const ownerId = getUserId(req)
  const track = sanitizeTrack(req.body.track)
  await playlistsStore.addTrack(req.params.id, ownerId, track)
  return { success: true }
}))

router.delete('/playlists/:id/tracks', asyncHandler(async (req) => {
  const ownerId = getUserId(req)
  // FIX NoSQL Injection: strictly cast to string
  const trackId = String(req.body.trackId || '')
  const source = String(req.body.source || '')
  if (!trackId || !source) throw new Error('trackId and source required')
  await playlistsStore.removeTrack(req.params.id, ownerId, trackId, source)
  return { success: true }
}))

// --- Settings ---

router.get('/settings', asyncHandler(async (req) => {
  const userId = getUserId(req)
  return await settingsStore.get(userId)
}))

router.put('/settings', asyncHandler(async (req) => {
  const userId = getUserId(req)
  const { theme, accent, customThemeData } = req.body
  return await settingsStore.upsert(userId, { theme, accent, customThemeData })
}))

// --- Search History ---

router.get('/search-history', asyncHandler(async (req) => {
  const userId = getUserId(req)
  const limit = Math.min(parseInt(req.query.limit) || 10, 200)
  return await searchHistoryStore.getRecent(userId, limit)
}))

router.post('/search-history', asyncHandler(async (req) => {
  const userId = getUserId(req)
  const query = String(req.body.query || '').trim().slice(0, 200)
  if (!query) throw new Error('Query required')
  return await searchHistoryStore.add(userId, query)
}))

router.delete('/search-history', asyncHandler(async (req) => {
  const userId = getUserId(req)
  await searchHistoryStore.clear(userId)
  return { success: true }
}))

// --- Listening History ---

router.get('/listening-history', asyncHandler(async (req) => {
  const userId = getUserId(req)
  const limit = Math.min(parseInt(req.query.limit) || 50, 200)
  return await listeningHistoryStore.getRecent(userId, limit)
}))

router.post('/listening-history', asyncHandler(async (req) => {
  const userId = getUserId(req)
  const track = sanitizeTrack(req.body.track)
  return await listeningHistoryStore.add(userId, track)
}))

router.delete('/listening-history', asyncHandler(async (req) => {
  const userId = getUserId(req)
  await listeningHistoryStore.clear(userId)
  return { success: true }
}))

// --- Badges ---

router.get('/badges', asyncHandler(async (req) => {
  const providerId = getProviderId(req)
  return await userStore.getBadges(providerId)
}))

module.exports = router
