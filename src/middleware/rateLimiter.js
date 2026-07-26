const rateLimit = require('express-rate-limit')

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  max: 100,
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

module.exports = {
  globalLimiter,
  strictAuthLimiter
}
