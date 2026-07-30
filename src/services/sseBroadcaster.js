const EventEmitter = require('events')
const userStore = require('./storage/userStore')
const db = require('./storage/database')
const { redis } = require('../middleware/cache')

class SSEBroadcaster extends EventEmitter {
  constructor() {
    super()
    this.clients = new Set()
    
    // Heartbeat ping every 15 seconds
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat()
    }, 15000)
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref()

    // Periodic metrics broadcast every 5 seconds
    this.metricsTimer = setInterval(() => {
      this.collectAndBroadcastMetrics()
    }, 5000)
    if (this.metricsTimer.unref) this.metricsTimer.unref()
  }

  addClient(res, req, user) {
    this.clients.add(res)
    
    if (req) {
      req.on('close', () => this.removeClient(res))
    }
    res.on('close', () => this.removeClient(res))

    // Send initial snapshot
    this.sendInitialSnapshot(res).catch(err => {
      console.error('[SSEBroadcaster] Error sending initial snapshot:', err.message)
    })
  }

  removeClient(res) {
    this.clients.delete(res)
  }

  sendHeartbeat() {
    if (this.clients.size === 0) return
    for (const client of this.clients) {
      try {
        client.write(': ping\n\n')
      } catch (err) {
        this.removeClient(client)
      }
    }
  }

  broadcast(event, data) {
    if (this.clients.size === 0) return
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of this.clients) {
      try {
        client.write(payload)
      } catch (err) {
        this.removeClient(client)
      }
    }
  }

  broadcastApiHit(hitData) {
    this.broadcast('api_hit', hitData)
  }

  broadcastLog(logData) {
    const payload = typeof logData === 'string' 
      ? { log: logData, timestamp: new Date().toISOString() }
      : logData
    this.broadcast('logs', payload)
  }

  async collectAndBroadcastMetrics() {
    if (this.clients.size === 0) return
    try {
      const memory = process.memoryUsage()
      const memMb = Math.round(memory.rss / 1024 / 1024)
      
      let activeSum = 0
      let totalUsersSum = 0

      try {
        const users = await userStore.countActiveUsers()
        if (users && typeof users === 'object') activeSum = Object.values(users).reduce((a, b) => a + b, 0)
        else if (typeof users === 'number') activeSum = users
      } catch (e) {}

      try {
        if (db && db.users && typeof db.users.countDocuments === 'function') {
          totalUsersSum = await db.users.countDocuments()
        }
      } catch (e) {}

      const uptimeSeconds = Math.floor(process.uptime())
      const redisStatus = redis ? redis.status : 'disabled'

      const metricsPayload = {
        timestamp: new Date().toISOString(),
        time: new Date().toLocaleTimeString(),
        ram: memMb,
        users: activeSum,
        stats: {
          activeUsersToday: activeSum,
          totalUsers: totalUsersSum
        },
        memory: {
          appMemoryMB: memMb,
          rss: memMb
        },
        redis: {
          enabled: Boolean(redis),
          status: redisStatus
        },
        uptimeSeconds
      }

      this.broadcast('metrics', metricsPayload)
    } catch (err) {
      console.error('[SSEBroadcaster] Metrics error:', err.message)
    }
  }

  async sendInitialSnapshot(res) {
    const memory = process.memoryUsage()
    const memMb = Math.round(memory.rss / 1024 / 1024)

    const initialMetrics = {
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleTimeString(),
      ram: memMb,
      users: 0,
      stats: {
        activeUsersToday: 0,
        totalUsers: 0
      },
      memory: {
        appMemoryMB: memMb,
        rss: memMb
      },
      redis: {
        enabled: Boolean(redis),
        status: redis ? redis.status : 'disabled'
      },
      uptimeSeconds: Math.floor(process.uptime()),
      history: []
    }

    // Immediately flush initial frame
    try {
      res.write(`event: metrics\ndata: ${JSON.stringify(initialMetrics)}\n\n`)
    } catch (e) {}

    // Async fetch additional background stats if available
    const countTotal = (db && db.users && typeof db.users.countDocuments === 'function')
      ? db.users.countDocuments().catch(() => 0)
      : Promise.resolve(0)

    Promise.all([
      userStore.countActiveUsers().catch(() => null),
      countTotal,
      (redis && redis.status === 'ready') ? redis.lrange('admin:metrics', 0, -1).catch(() => null) : null,
      (redis && redis.status === 'ready') ? redis.lrange('admin:logs', 0, -1).catch(() => null) : null
    ]).then(([users, total, rawHistory, logs]) => {
      let activeSum = 0
      let totalUsersSum = total || 0
      if (users && typeof users === 'object') activeSum = Object.values(users).reduce((a, b) => a + b, 0)
      if (users && typeof users === 'number') activeSum = users

      let history = []
      if (rawHistory) {
        history = rawHistory.map(item => {
          try { return JSON.parse(item) } catch(e) { return null }
        }).filter(Boolean)
      }

      if (activeSum > 0 || totalUsersSum > 0 || history.length > 0) {
        initialMetrics.users = activeSum
        initialMetrics.stats.activeUsersToday = activeSum
        initialMetrics.stats.totalUsers = totalUsersSum
        initialMetrics.history = history
        try {
          res.write(`event: metrics\ndata: ${JSON.stringify(initialMetrics)}\n\n`)
        } catch (e) {}
      }

      if (logs && logs.length > 0) {
        try {
          res.write(`event: logs\ndata: ${JSON.stringify(logs)}\n\n`)
        } catch (e) {}
      }
    }).catch(err => {
      console.error('[SSEBroadcaster] Initial snapshot background error:', err.message)
    })
  }
}

const sseBroadcaster = new SSEBroadcaster()
module.exports = sseBroadcaster
