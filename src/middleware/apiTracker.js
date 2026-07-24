const { redis } = require('./cache')

// Basic UUID and Number normalizer for paths
function normalizePath(path) {
  return path
    // Replace UUIDs
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, ':id')
    // Replace standalone numbers
    .replace(/\/[0-9]+(\/|$)/g, '/:id$1')
}

function getHourKey() {
  const d = new Date()
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hour = String(d.getUTCHours()).padStart(2, '0')
  return `api:stats:${year}-${month}-${day}-${hour}`
}

function apiTracker(req, res, next) {
  // We only track API routes
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/me/')) {
    return next()
  }

  // Skip polling endpoints from admin itself to avoid polluting stats
  if (req.path === '/api/admin/logs' || req.path === '/api/admin/metrics' || req.path === '/api/admin/stats/api') {
    return next()
  }

  if (redis && redis.status === 'ready') {
    const method = req.method
    const path = normalizePath(req.path)
    const statKey = `${method} ${path}`
    
    const hashKey = getHourKey()
    
    redis.hincrby(hashKey, statKey, 1).catch(err => {
      console.error('[ApiTracker] Redis error:', err.message)
    })
    
    // Set expiry to 48 hours to clean up automatically
    redis.expire(hashKey, 48 * 3600).catch(() => {})
  }

  next()
}

async function syncApiStats() {
  if (!redis || redis.status !== 'ready') return
  const db = require('../services/storage/database')
  if (!db.apiStats) return

  try {
    // Find keys from older hours (we just scan all api:stats:* and process those that are NOT the current hour)
    const currentHourKey = getHourKey()
    const keys = await redis.keys('api:stats:*')
    
    for (const key of keys) {
      if (key !== currentHourKey) {
        const data = await redis.hgetall(key)
        if (Object.keys(data).length > 0) {
          // Parse the date from the key (api:stats:YYYY-MM-DD-HH)
          const parts = key.split(':')
          const timeStr = parts[2]
          
          await db.apiStats.updateOne(
            { timestamp: timeStr },
            { $inc: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, parseInt(v, 10)])) },
            { upsert: true }
          )
        }
        // Delete the key after syncing
        await redis.del(key)
      }
    }
  } catch (err) {
    console.error('[ApiTracker] Sync error:', err.message)
  }
}

module.exports = { apiTracker, syncApiStats }
