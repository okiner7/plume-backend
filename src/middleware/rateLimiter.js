const rateLimit = require('express-rate-limit')

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 100 : 2000,
  max: process.env.NODE_ENV === 'test' ? 100 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: {
    success: false,
    error: 'Too many requests, please try again later.'
  }
})

const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: {
    success: false,
    error: 'Too many requests, please try again later.'
  }
})

const streamLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: 300,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: {
    success: false,
    error: 'Too many stream requests, please try again later.'
  }
})

module.exports = {
  globalLimiter,
  strictAuthLimiter,
  streamLimiter
}
