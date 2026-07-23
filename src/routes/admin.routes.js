const { Router } = require('express')
const asyncHandler = require('../middleware/asyncHandler')
const adminAuth = require('../middleware/adminAuth')
const userStore = require('../services/storage/userStore')
const proxyManager = require('../middleware/proxyManager')
const telegramBot = require('../services/bot/telegramBot')
const searchHistoryStore = require('../services/storage/searchHistoryStore')
const listeningHistoryStore = require('../services/storage/listeningHistoryStore')
const statsStore = require('../services/storage/statsStore')
const { myCache } = require('../middleware/cache')
const fs = require('fs')
const path = require('path')
const multer = require('multer')
const crypto = require('crypto')
const updatesStore = require('../services/storage/updatesStore')

const router = Router()

// Configure multer for update uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'data', 'updates')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname)
  }
})
const upload = multer({ storage })

// Log interception for Admin Panel
const { redis } = require('../middleware/cache')
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
  const metricsInterval = setInterval(async () => {
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
      if (!err.message.includes('session that has ended') && !err.message.includes('Client must be connected')) {
        console.error('[Admin] Metrics gather error:', err.message)
      }
    }
  }, 5000)
  metricsInterval.unref()
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

router.get('/updates', asyncHandler(async (req) => {
  return updatesStore.getUpdates()
}))

router.post('/updates', upload.single('file'), asyncHandler(async (req) => {
  if (!req.file) {
    throw new Error('No update file uploaded')
  }
  
  const { version, releaseNotes, platform, mandatory, channel = 'stable' } = req.body
  if (!version || !platform) {
    throw new Error('Version and platform are required')
  }

  // Calculate SHA256
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(req.file.path)
  await new Promise((resolve, reject) => {
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve())
    stream.on('error', err => reject(err))
  })
  const sha256 = hash.digest('hex')

  updatesStore.addUpdate(platform, channel, {
    version,
    releaseNotes: releaseNotes || '',
    mandatory: mandatory === 'true',
    filename: req.file.originalname,
    size: req.file.size,
    sha256
  })

  return { message: 'Update deployed successfully' }
}))

router.delete('/updates/:platform/:channel/:version', asyncHandler(async (req) => {
  const { platform, channel, version } = req.params
  
  // Find update to delete the physical file
  const platformData = updatesStore.getUpdates()[platform]
  if (platformData && platformData[channel]) {
    const update = platformData[channel].find(u => u.version === version)
    if (update) {
      const filePath = path.join(process.cwd(), 'data', 'updates', update.filename)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    }
  }

  updatesStore.deleteUpdate(platform, channel, version)
  return { message: 'Update deleted successfully' }
}))

module.exports = router
