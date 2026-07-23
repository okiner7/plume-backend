const jwt = require('jsonwebtoken')
const { JWT_SECRET } = require('../config/env')
const userStore = require('../services/storage/userStore')

module.exports = (req, res, next) => {
  const header = req.headers.authorization
  if (!header) return res.status(401).json({ error: 'No token provided' })

  const token = header.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    
    // Update lastActiveAt if needed
    if (decoded.provider_id) {
      const platform = String(req.headers['x-lunex-platform'] || 'unknown').slice(0, 50)
      userStore.updateLastActive(decoded.provider_id, platform).catch(console.error)
    }

    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}
