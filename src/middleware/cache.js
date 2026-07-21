const Redis = require('ioredis')
const NodeCache = require('node-cache')

const isProd = process.env.NODE_ENV === 'production'

// ─── Development Fallback (In-Memory) ─────────────────────────────────────────
// На Windows в разработке Redis ставить муторно, поэтому используем node-cache.
// В продакшене (PM2 cluster) будет использоваться Redis для общей памяти.
// ─────────────────────────────────────────────────────────────────────────────
const localCache = new NodeCache({ stdTTL: 7200, checkperiod: 600 })

let redis = null
if (isProd || process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      if (times > 10) return null
      return Math.min(times * 500, 5000)
    }
  })
  redis.on('connect', () => {
    if (typeof process.env.NODE_APP_INSTANCE === 'undefined' || process.env.NODE_APP_INSTANCE === '0') {
      const total = process.env.instances || 4
      console.log(`[Redis] Connected ${total}/${total}`)
    }
  })
  redis.on('error', (err) => console.error('[Redis] Error:', err.message))
}

const cacheMiddleware = (duration = 7200) => {
  return async (req, res, next) => {
    if (req.method !== 'GET') return next()

    const key = `lunex:${req.originalUrl}`

    // Чтение из кэша
    if (redis) {
      try {
        const cached = await redis.get(key)
        if (cached) return res.json(JSON.parse(cached))
      } catch (err) {
        console.warn('[Cache] Redis get error:', err.message)
      }
    } else {
      const cached = localCache.get(key)
      if (cached) return res.json(cached)
    }

    // Перехват записи
    const originalJson = res.json.bind(res)
    res.json = async (body) => {
      if (body && body.success !== false) {
        if (redis) {
          try {
            await redis.setex(key, duration, JSON.stringify(body))
          } catch (err) {
            console.warn('[Cache] Redis set error:', err.message)
          }
        } else {
          localCache.set(key, body, duration)
        }
      }
      originalJson(body)
    }

    next()
  }
}

const myCache = {
  async getStats() {
    if (redis) {
      try {
        const info = await redis.info('memory')
        const memMatch = info.match(/used_memory:(\d+)/)
        const keysCount = await redis.dbsize()
        return { vsize: memMatch ? parseInt(memMatch[1]) : 0, ksize: 0, keys: keysCount }
      } catch {
        return { vsize: 0, ksize: 0, keys: 0 }
      }
    } else {
      const stats = localCache.getStats()
      return { vsize: stats.vsize, ksize: stats.ksize, keys: stats.keys }
    }
  },
  async flushAll() {
    if (redis) {
      try {
        await redis.flushdb()
        return 1
      } catch { return 0 }
    } else {
      const stats = localCache.getStats()
      localCache.flushAll()
      return stats.keys
    }
  }
}

module.exports = { cacheMiddleware, myCache, redis }

