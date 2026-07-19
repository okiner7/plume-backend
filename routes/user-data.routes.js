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
  const { track } = req.body
  if (!track) throw new Error('Track required')
  return await likesStore.add(userId, track, providerId)
}))

router.delete('/likes', asyncHandler(async (req) => {
  const userId = getUserId(req)
  const { trackId, source } = req.body
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
  const { name } = req.body
  if (!name) throw new Error('Name required')
  return await playlistsStore.create(ownerId, name)
}))

router.put('/playlists/:id', asyncHandler(async (req) => {
  const ownerId = getUserId(req)
  const { name } = req.body
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
  const { track } = req.body
  if (!track) throw new Error('Track required')
  await playlistsStore.addTrack(req.params.id, ownerId, track)
  return { success: true }
}))

router.delete('/playlists/:id/tracks', asyncHandler(async (req) => {
  const ownerId = getUserId(req)
  const { trackId, source } = req.body
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
  const { query } = req.body
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
  const { track } = req.body
  if (!track) throw new Error('Track required')
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
