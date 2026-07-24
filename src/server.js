require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const compression = require('compression')
const rateLimit = require('express-rate-limit')
const morgan = require('morgan')
const routes = require('./routes')
const telegramBot = require('./services/bot/telegramBot')
const proxyHealth = require('./services/health/proxyHealth')
const yt = require('./services/youtube')
const { apiTracker, syncApiStats } = require('./middleware/apiTracker')

const app = express()

// Доверяем Nginx и Cloudflare (читаем реальные IP-адреса пользователей)
app.set('trust proxy', 1)

// Security Headers
app.use(helmet({
  hsts: false, // Отключаем HSTS на бэкенде, так как HTTPS рулится на уровне Cloudflare
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null,
    }
  }
}))

// Compression (Gzip)
app.use(compression())

// Static Files (Disable cache for admin panel during dev)
app.use(express.static('public', { setHeaders: (res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private') } }))

// HTTP Logging (skip OPTIONS to prevent console spam)
app.use(morgan('dev', {
  skip: (req, res) => req.method === 'OPTIONS'
}))

// Require App Secret for all API routes (Private API)
const { APP_SECRET } = require('./config/env')
const crypto = require('crypto')

app.use((req, res, next) => {
  // Allow Telegram Webhooks, Status, Root endpoint, OAuth routes, static Admin UI, and favicon
  if (req.path === '/api/status' || req.path === '/' || req.path === '/favicon.ico' || req.path.startsWith('/auth/') || req.path.startsWith('/admin') || req.path.startsWith('/api/admin') || req.path.startsWith('/api/updates') || req.method === 'OPTIONS') return next()
  
  const timestamp = req.headers['x-plume-timestamp']
  const signature = req.headers['x-plume-signature']
  
  if (!timestamp || !signature) {
    return res.status(403).json({ success: false, error: 'Access Denied: Missing Signature' })
  }

  // Prevent replay attacks (max 60 seconds diff)
  const now = Date.now()
  if (Math.abs(now - parseInt(timestamp, 10)) > 60000) {
    return res.status(403).json({ success: false, error: 'Access Denied: Request Expired' })
  }

  // Calculate Expected HMAC
  const expectedSignature = crypto.createHmac('sha256', APP_SECRET)
                                  .update(req.originalUrl + timestamp)
                                  .digest('hex')

  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expectedSignature)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    console.warn(`[Security] Invalid signature from ${req.ip} for ${req.originalUrl}`)
    return res.status(403).json({ success: false, error: 'Access Denied: Invalid Signature' })
  }
  
  next()
})

// Rate Limiting (max 500 requests per 10 minutes per IP)
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 500,
  message: { success: false, error: 'Вы превысили лимит запросов. Блокировка на 10 минут.' }
})
app.use(limiter)

// CORS — разрешаем только конкретные origins (LNX-2026-008 fix)
const ALLOWED_ORIGINS = [
  /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.\d+\.\d+\.\d+)(:\d+)?$/,
  /^https:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.\d+\.\d+\.\d+)(:\d+)?$/,
  /^plume:\/\//,                   // Electron deep-link
  /^https?:\/\/(www\.|api\.)?plumeoff\.ru$/
]
app.use(cors({
  origin: (origin, callback) => {
    // Атомарные запросы (Electron, curl, mobile) — пропускаем
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.some(r => r.test(origin))) return callback(null, true)
    callback(new Error(`CORS: origin '${origin}' not allowed`))
  },
  maxAge: 86400
}))
app.use(express.json())

app.use(apiTracker)
app.use(routes)

app.use((err, req, res, next) => {
  console.error('[ERROR]:', err.message)
  res.status(err.status || 500).json({ success: false, error: err.message || 'Internal server error' })
})

if (require.main === module) {
  const PORT = process.env.PORT || 3000
  app.listen(PORT, () => {
    const isPrimaryWorker = typeof process.env.NODE_APP_INSTANCE === 'undefined' || process.env.NODE_APP_INSTANCE === '0'
    
    if (isPrimaryWorker) {
      console.log('\n=======================================')
      console.log(`[Plume Backend v2] Server is LIVE`)
      console.log(`[Port]    ${PORT}`)
      console.log(`[PID]     ${process.pid}`)
      console.log('=======================================\n')
    }

    if (process.env.NODE_ENV !== 'test') {
      if (isPrimaryWorker) {
        telegramBot.start()
        proxyHealth.start()
        // Sync API stats every hour
        setInterval(syncApiStats, 60 * 60 * 1000)
      } else {
        console.log(`[Worker] Secondary instance started (Instance ${process.env.NODE_APP_INSTANCE})`)
      }

      yt.init().catch(err => console.error('[YouTube] Init error:', err.message))
    }
  })
}

module.exports = app
