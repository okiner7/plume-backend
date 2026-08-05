require('dotenv').config()
const http = require('http')
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const compression = require('compression')
const { globalLimiter, streamLimiter } = require('./middleware/rateLimiter')
const morgan = require('morgan')
const routes = require('./routes')
const telegramBot = require('./services/bot/telegramBot')
const proxyHealth = require('./services/health/proxyHealth')
const yt = require('./services/youtube')
const { apiTracker, syncApiStats } = require('./middleware/apiTracker')
const { initSocketServer } = require('./socket')
const http3Middleware = require('./middleware/http3')

const app = express()

// HTTP/3 (QUIC) & WebTransport Alt-Svc negotiation
app.use(http3Middleware)

// Доверяем Nginx и Cloudflare (читаем реальные IP-адреса пользователей)
app.set('trust proxy', true)

// Security Headers
app.use(helmet({
  hsts: false, // Отключаем HSTS на бэкенде, так как HTTPS рулится на уровне Cloudflare
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Позволяет плееру на фронтенде загружать аудио поток
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
  if (req.path === '/api/status' || req.path === '/api/yt/stream' || req.path === '/api/sc/stream' || req.path === '/' || req.path === '/favicon.ico' || req.path.startsWith('/auth/') || req.path.startsWith('/admin') || req.path.startsWith('/api/admin') || req.path.startsWith('/api/updates') || req.path.startsWith('/socket.io') || req.method === 'OPTIONS') return next()
  
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

// Global Rate Limiting (100 requests per 15 minutes per IP)
app.use(globalLimiter)

// Dedicated Audio Streaming Rate Limiting (30 requests per minute per IP)
app.use(['/api/yt/stream', '/api/sc/stream'], streamLimiter)

// CORS — разрешаем только конкретные origins (LNX-2026-008 fix)
const ALLOWED_ORIGINS = [
  /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.\d+\.\d+\.\d+)(:\d+)?$/,
  /^https:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.\d+\.\d+\.\d+)(:\d+)?$/,
  /^plume:\/\//,                   // Electron deep-link
  /^https?:\/\/(www\.|api\.)?plumeoff\.ru$/
]
const corsOptions = {
  origin: (origin, callback) => {
    // Атомарные запросы (Electron, curl, mobile) — пропускаем
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.some(r => r.test(origin))) return callback(null, true)
    callback(new Error(`CORS: origin '${origin}' not allowed`))
  },
  maxAge: 86400
}
app.use(cors(corsOptions))
app.use(express.json())

// HTTP Server and Socket.io setup
const server = http.createServer(app)
const io = initSocketServer(server, corsOptions)
app.server = server
app.io = io

app.use(apiTracker)
app.use(routes)

app.use((err, req, res, next) => {
  // 1. Prevent ERR_HTTP_HEADERS_SENT if audio streaming headers were already sent to client
  if (res.headersSent) {
    return next(err)
  }

  const status = err.status || err.statusCode || (err.name === 'AppError' || err.name === 'ZodError' ? 400 : 500)
  const safeMessage = typeof err?.message === 'string' 
    ? err.message 
    : (typeof err === 'string' ? err : 'Internal server error')
    
  console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, safeMessage)

  // Send Telegram alert for unexpected server errors (5xx only, not 4xx client errors)
  if (status >= 500) {
    const alertMsg = [
      `❌ *Server Error ${status}*`,
      `Route: \`${req.method} ${req.originalUrl}\``,
      `Message: ${safeMessage.slice(0, 300)}`,
      (err && err.stack) ? `\`\`\`\n${String(err.stack).slice(0, 600)}\n\`\`\`` : ''
    ].filter(Boolean).join('\n')
    telegramBot.sendAdminAlert(alertMsg).catch(() => {})
  }

  res.status(status).json({ success: false, error: safeMessage })
})

if (require.main === module) {
  const PORT = process.env.PORT || 3000
  server.listen(PORT, () => {
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

