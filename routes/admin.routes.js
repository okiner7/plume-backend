const { Router } = require('express')
const asyncHandler = require('../src/middleware/asyncHandler')
const adminAuth = require('../src/middleware/adminAuth')
const userStore = require('../services/storage/userStore')
const proxyManager = require('../src/middleware/proxyManager')
const telegramBot = require('../services/bot/telegramBot')
const searchHistoryStore = require('../services/storage/searchHistoryStore')
const listeningHistoryStore = require('../services/storage/listeningHistoryStore')
const statsStore = require('../services/storage/statsStore')
const { myCache } = require('../src/middleware/cache')
const fs = require('fs')
const path = require('path')

const router = Router()

// Log interception for Admin Panel
const { redis } = require('../src/middleware/cache')
const originalLog = console.log
const originalError = console.error

function captureLog(type, args) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')
  const logStr = `[${new Date().toISOString()}] [${type}] [Worker ${process.env.NODE_APP_INSTANCE || 0}] ${msg}`
  
  if (redis && redis.status === 'ready') {
    redis.rpush('admin:logs', logStr).catch(() => {})
    redis.ltrim('admin:logs', -200, -1).catch(() => {})
  }
}

console.log = function(...args) {
  captureLog('INFO', args)
  originalLog.apply(console, args)
}
console.error = function(...args) {
  captureLog('ERROR', args)
  originalError.apply(console, args)
}

// Metrics History for Chart (Only gathered by primary instance to avoid overlaps)
const isPrimaryWorker = typeof process.env.NODE_APP_INSTANCE === 'undefined' || process.env.NODE_APP_INSTANCE === '0'
if (isPrimaryWorker) {
  setInterval(async () => {
    try {
      const memory = process.memoryUsage()
      const memMb = Math.round(memory.rss / 1024 / 1024)
      const users = await userStore.countActiveUsers()
      let activeSum = 0
      if (users) activeSum = Object.values(users).reduce((a,b)=>a+b, 0)
      
      const metric = JSON.stringify({
        time: new Date().toLocaleTimeString(),
        ram: memMb,
        users: activeSum
      })
      
      if (redis && redis.status === 'ready') {
        redis.rpush('admin:metrics', metric).catch(() => {})
        redis.ltrim('admin:metrics', -50, -1).catch(() => {})
      }
    } catch (err) {
      console.error('[Admin] Metrics gather error:', err.message)
    }
  }, 5000)
}


// All routes here are protected by adminAuth
router.use(adminAuth)

router.get('/core.js', (req, res) => {
  res.sendFile(path.join(__dirname, '../private/core.js'))
})

router.get('/proxies', asyncHandler(async (req) => {
  return proxyManager.getProxyStats().proxies
}))

router.post('/proxies', asyncHandler(async (req) => {
  const { url } = req.body
  if (!url) throw new Error('Proxy URL required')
  const added = proxyManager.addProxy(url)
  if (!added) throw new Error('Proxy already exists or invalid')
  return { message: 'Proxy added successfully' }
}))

router.delete('/proxies', asyncHandler(async (req) => {
  const { url } = req.body
  if (!url) throw new Error('Proxy URL required')
  const removed = proxyManager.removeProxy(url)
  if (!removed) throw new Error('Proxy not found')
  return { message: 'Proxy removed successfully' }
}))

router.post('/proxies/reset', asyncHandler(async (req) => {
  // Hacky way to reset cooldowns: we iterate over the internal pool
  const pool = proxyManager._pool
  let resetCount = 0
  if (pool && pool.proxies) {
    const now = Date.now()
    for (const proxy of pool.proxies) {
      if (proxy.cooldownUntil > now) {
        proxy.cooldownUntil = 0
        proxy.fails = 0
        resetCount++
      }
    }
  }
  return { message: `Reset cooldowns for ${resetCount} proxies` }
}))

router.get('/users/recent', asyncHandler(async (req) => {
  const users = await userStore.getRecentUsers(50)
  return users
}))

router.delete('/cache', asyncHandler(async (req) => {
  const keysCleared = await myCache.flushAll()
  if (global.gc) {
    global.gc() // Trigger garbage collection if exposed
  }
  return { message: 'Cache cleared successfully', keysCleared }
}))

router.post('/users/:id/ban', asyncHandler(async (req) => {
  const userId = req.params.id
  await userStore.setBanStatus(userId, true)
  return { message: 'User banned successfully' }
}))

router.delete('/users/:id/ban', asyncHandler(async (req) => {
  const userId = req.params.id
  await userStore.setBanStatus(userId, false)
  return { message: 'User unbanned successfully' }
}))

router.delete('/users/:id', asyncHandler(async (req) => {
  const userId = req.params.id
  await userStore.deleteUser(userId)
  return { message: 'User deleted successfully' }
}))

router.get('/users/:id/details', asyncHandler(async (req) => {
  const userId = req.params.id
  const user = await userStore.findByProviderId(userId)
  if (!user) throw new Error('User not found')
  
  const searchHist = await searchHistoryStore.getRecent(user.userId || userStore.buildUserId(user.provider, user.providerId), 50)
  const listeningHist = await listeningHistoryStore.getRecent(user.userId || userStore.buildUserId(user.provider, user.providerId), 50)
  
  const playlistsStore = require('../services/storage/playlistsStore')
  const playlists = await playlistsStore.getAll(user.userId || userStore.buildUserId(user.provider, user.providerId))

  const likesStore = require('../services/storage/likesStore')
  const likesCount = await likesStore.countByUser(user.userId || userStore.buildUserId(user.provider, user.providerId))

  return {
    user,
    searchHistory: searchHist,
    listeningHistory: listeningHist,
    playlists: playlists,
    likesCount: likesCount
  }
}))

router.get('/insights/top-searches', asyncHandler(async (req) => {
  return statsStore.getTopSearches ? await statsStore.getTopSearches(50) : []
}))

router.get('/insights/top-tracks', asyncHandler(async (req) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50)
  return await statsStore.getTopTracks(limit)
}))

router.get('/logs', asyncHandler(async (req) => {
  if (redis && redis.status === 'ready') {
    return await redis.lrange('admin:logs', 0, -1)
  }
  return []
}))

router.get('/metrics/history', asyncHandler(async (req) => {
  if (redis && redis.status === 'ready') {
    const metrics = await redis.lrange('admin:metrics', 0, -1)
    return metrics.map(m => JSON.parse(m))
  }
  return []
}))

router.post('/restart', asyncHandler(async (req) => {
  // Respond first, then exit
  setTimeout(() => {
    process.exit(0)
  }, 1000)
  return { message: 'Server is restarting...' }
}))

module.exports = router
