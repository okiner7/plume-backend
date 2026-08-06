const { Router } = require('express')
const authRequired = require('../middleware/authRequired')
const { TELEGRAM_BOT_TOKEN } = require('../config/env')
const https = require('https')

const router = Router()

router.get('/', authRequired, async (req, res) => {
  const userStore = require('../services/storage/userStore')
  const providerId = req.user.provider_id || req.user.id
  let dbUser = await userStore.findByProviderId(providerId)
  if (!dbUser) {
    const db = require('../services/storage/database')
    if (db.users) dbUser = await db.users.findOne({ $or: [{ providerId }, { userId: providerId }, { _id: providerId }] })
  }
  
  const user = { ...req.user, ...(dbUser || {}) }
  if (user.avatar && !user.avatar.startsWith('http')) {
    user.avatar = `/api/me/avatar`
  }
  res.json({ success: true, data: user })
})

// LNX-2026-007: безопасный прокси для аватаров Telegram — bot token остаётся на сервере
router.get('/avatar', authRequired, async (req, res) => {
  const userStore = require('../services/storage/userStore')
  const providerId = req.user.provider_id || req.user.id
  let dbUser = await userStore.findByProviderId(providerId)
  if (!dbUser) {
    const db = require('../services/storage/database')
    if (db.users) dbUser = await db.users.findOne({ $or: [{ providerId }, { userId: providerId }, { _id: providerId }] })
  }

  const filePath = (dbUser && dbUser.avatar) || req.user.avatar
  if (!filePath) {
    return res.status(404).json({ error: 'No avatar' })
  }
  if (filePath.startsWith('http')) {
    return res.redirect(filePath)
  }
  if (!TELEGRAM_BOT_TOKEN) {
    return res.status(500).json({ error: 'Telegram bot token not configured' })
  }

  const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath.replace(/^\//, '')}`
  https.get(url, (tgRes) => {
    if (tgRes.statusCode !== 200) return res.status(404).json({ error: 'Avatar not found' })
    res.setHeader('Content-Type', tgRes.headers['content-type'] || 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    tgRes.pipe(res)
  }).on('error', () => res.status(500).json({ error: 'Failed to fetch avatar' }))
})

module.exports = router
