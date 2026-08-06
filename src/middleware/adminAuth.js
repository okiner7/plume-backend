const { DEV_EMAILS, DEV_TELEGRAM_IDS } = require('../config/env')
const userStore = require('../services/storage/userStore')
const jwt = require('../services/auth/jwt')

const adminAuth = async (req, res, next) => {
  try {
    let token = null
    const authHeader = req.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1]
    } else if (authHeader) {
      token = authHeader
    } else if (req.query && req.query.token) {
      token = req.query.token
    }

    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' })
    }

    const decoded = jwt.verify(token)
    if (!decoded) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token' })
    }

    const providerId = decoded.provider_id || decoded.id
    const userEmail = (decoded.email || '').toLowerCase().trim()
    const tgId = String(decoded.provider_id || decoded.id || '').trim()

    const devEmails = DEV_EMAILS.map(e => e.toLowerCase().trim())
    const devTgIds = DEV_TELEGRAM_IDS.map(i => String(i).trim())

    // 1. Check env variables first (super-admins)
    const isEnvAdmin = 
      (userEmail && devEmails.includes(userEmail)) ||
      (tgId && devTgIds.includes(tgId))

    if (isEnvAdmin) {
      req.user = decoded
      return next()
    }

    // 2. Check DB for Developer badge if user exists
    if (providerId) {
      const badges = await userStore.getBadges(providerId)
      if (badges && badges.some(b => (typeof b === 'string' ? b === 'developer' : b.id === 'developer'))) {
        req.user = decoded
        return next()
      }
    }

    // 3. Fallback for tokens issued by admin generator or super-admin login
    if (decoded.provider === 'google' || decoded.provider === 'telegram' || decoded.role === 'admin') {
      req.user = decoded
      return next()
    }

    return res.status(403).json({ success: false, error: 'Forbidden: Admin access required' })
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token' })
    }
    console.error('[AdminAuth] Error:', err)
    return res.status(500).json({ success: false, error: 'Internal Server Error during auth check' })
  }
}

module.exports = adminAuth
