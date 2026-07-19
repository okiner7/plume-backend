const { DEV_EMAILS, DEV_TELEGRAM_IDS } = require('../config/env')
const userStore = require('../../services/storage/userStore')
const jwt = require('../../services/auth/jwt')

const adminAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' })
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token)
    
    // Check hardcoded env variables first (super-admins)
    const isEnvAdmin = 
      (decoded.provider === 'telegram' && DEV_TELEGRAM_IDS.includes(String(decoded.provider_id))) ||
      (decoded.provider === 'google' && DEV_EMAILS.includes(decoded.email))

    if (isEnvAdmin) {
      req.user = decoded
      return next()
    }

    // Check DB for Developer badge just in case
    const badges = await userStore.getBadges(decoded.provider_id)
    if (badges && badges.some(b => b.id === 'developer')) {
      req.user = decoded
      return next()
    }

    return res.status(403).json({ success: false, error: 'Forbidden: Admin access required' })
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token' })
  }
}

module.exports = adminAuth
