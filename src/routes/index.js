const { Router } = require('express')
const youtubeRoutes = require('./youtube.routes')
const soundcloudRoutes = require('./soundcloud.routes')
const authRoutes = require('./auth.routes')
const meRoutes = require('./me.routes')
const userDataRoutes = require('./user-data.routes')
const themesRoutes = require('./themes.routes')
const adminRoutes = require('./admin.routes')
const updatesRoutes = require('./updates.routes')
const proxyRoutes = require('./proxy.routes')
const { myCache, redis } = require('../middleware/cache')
const db = require('../services/storage/database')
const statsStore = require('../services/storage/statsStore')
const userStore = require('../services/storage/userStore')
const proxyHealth = require('../services/health/proxyHealth')
const { getProxyStats } = require('../middleware/proxyManager')
const adminAuth = require('../middleware/adminAuth')
const imageProxyMiddleware = require('../middleware/imageProxy')

const router = Router()


router.get('/', (req, res) => res.json({ status: 'ok', service: 'Plume API' }))

router.get('/api/status', adminAuth, async (req, res) => {
    const memUsage = process.memoryUsage();
    const appMb = (memUsage.rss / 1024 / 1024).toFixed(2);
    const stats = await myCache.getStats();
    const cacheMb = ((stats.vsize) / 1024 / 1024).toFixed(2);
    const redisStatus = redis ? redis.status : 'disconnected';
    
    // Fetch stats from DB
    const getCount = (collection) => (collection ? collection.countDocuments({}).catch(() => 0) : Promise.resolve(0))
    const [usersCount, playlistsCount, likesCount, globalStats, activeUsers] = await Promise.all([
        userStore.countAllUsers(),
        getCount(db.playlists),
        getCount(db.likes),
        statsStore.getGlobalStats(),
        userStore.countActiveUsers()
    ])

    res.json({
        success: true,
        data: {
            memory: {
                appMemoryMB: parseFloat(appMb),
                cacheMemoryMB: parseFloat(cacheMb),
                cacheItems: stats.keys,
            },
            redis: {
                enabled: !!redis,
                status: redisStatus
            },
            stats: {
                totalUsers: usersCount,
                activeUsersToday: activeUsers,
                totalPlaylists: playlistsCount,
                totalLikes: likesCount,
                totalListens: globalStats.totalListens,
                totalSearches: globalStats.totalSearches
            },
            // LNX-2026-004 fix: не раскрываем IP/URL прокси публично — только счётчики
            proxy: {
              total: getProxyStats().total,
              healthy: getProxyStats().healthy
            },
            proxyHealthy: proxyHealth.isHealthy(),
            uptimeSeconds: process.uptime()
        }
    })
})

router.use('/api/yt', imageProxyMiddleware, youtubeRoutes)
router.use('/api/sc', imageProxyMiddleware, soundcloudRoutes)
router.use('/api/proxy', proxyRoutes)
router.use('/auth', authRoutes)
router.use('/me', imageProxyMiddleware, meRoutes)
router.use('/me', imageProxyMiddleware, userDataRoutes)
router.use('/themes', themesRoutes)
router.use('/api/admin', adminRoutes)
router.use('/api/updates', updatesRoutes)

module.exports = router
