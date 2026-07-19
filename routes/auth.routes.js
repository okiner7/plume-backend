const { Router } = require('express')
const asyncHandler = require('../src/middleware/asyncHandler')
const jwt = require('../services/auth/jwt')
const google = require('../services/auth/google')
const telegram = require('../services/auth/telegram')
const { DEV_EMAILS, DEV_TELEGRAM_IDS, FRONTEND_URL } = require('../src/config/env')
const userStore = require('../services/storage/userStore')
const badgeStore = require('../services/storage/badgeStore')
const authCodeStore = require('../services/storage/authCodeStore')

const router = Router()

router.get('/google', (req, res) => {
  const state = req.query.callback || ''
  res.redirect(google.getAuthUrl(state))
})

// Разрешённые префиксы для callback (локальный сервер Electron и deep link)
const ALLOWED_CALLBACK_PREFIXES = ['http://localhost:', 'https://localhost:', 'lunex://']

function isSafeCallback(url) {
  if (!url) return false
  return ALLOWED_CALLBACK_PREFIXES.some(prefix => url.startsWith(prefix))
}

router.get('/google/callback', asyncHandler(async (req, res) => {
  const { code, state } = req.query
  const callback = req.query.callback || state
  if (!code) throw new Error('Authorization code required')

  const tokens = await google.exchangeCode(code)
  const profile = await google.getProfile(tokens.access_token)

  const user = await userStore.findOrCreate('google', profile.googleId, {
    name: profile.name,
    email: profile.email,
    avatar: profile.avatar
  })

  if (DEV_EMAILS.includes(profile.email)) {
    await badgeStore.grantDeveloperBadge(profile.googleId)
  }

  const token = jwt.sign({
    provider: 'google',
    provider_id: profile.googleId,
    email: profile.email,
    name: profile.name,
    avatar: profile.avatar
  })

  // BUG-01 fix: валидируем callback чтобы предотвратить Open Redirect
  const redirectUrl = isSafeCallback(callback) ? callback : FRONTEND_URL
  res.redirect(`${redirectUrl}?token=${token}`)
}))

router.post('/telegram', asyncHandler(async (req) => {
  const data = req.body
  const profile = telegram.validateAuthData(data)
  if (!profile) throw new Error('Invalid Telegram auth data')

  await userStore.findOrCreate('telegram', profile.telegramId, {
    name: profile.username,
    email: '',
    avatar: profile.avatar
  })

  if (DEV_TELEGRAM_IDS.includes(profile.telegramId)) {
    await badgeStore.grantDeveloperBadge(profile.telegramId)
  }

  const token = jwt.sign({
    provider: 'telegram',
    provider_id: profile.telegramId,
    name: profile.username,
    avatar: profile.avatar
  })

  return { token, user: { ...profile, badges: await userStore.getBadges(profile.telegramId) } }
}))

router.post('/verify-code', asyncHandler(async (req) => {
  const { code } = req.body
  if (!code) throw new Error('Code required')

  const codeDoc = await authCodeStore.findByCode(code)
  if (!codeDoc) throw new Error('Invalid code')

  if (new Date() > new Date(codeDoc.expiresAt)) {
    await authCodeStore.remove(codeDoc._id)
    throw new Error('Code expired')
  }

  await authCodeStore.remove(codeDoc._id)

  await userStore.findOrCreate('telegram', codeDoc.telegramId, {
    name: codeDoc.name,
    email: '',
    avatar: codeDoc.avatar
  })

  if (DEV_TELEGRAM_IDS.includes(codeDoc.telegramId)) {
    await badgeStore.grantDeveloperBadge(codeDoc.telegramId)
  }

  const token = jwt.sign({
    provider: 'telegram',
    provider_id: codeDoc.telegramId,
    name: codeDoc.name,
    avatar: codeDoc.avatar
  })

  return {
    token,
    user: {
      telegramId: codeDoc.telegramId,
      username: codeDoc.name,
      avatar: codeDoc.avatar,
      badges: await userStore.getBadges(codeDoc.telegramId)
    }
  }
}))

router.get('/verify', asyncHandler(async (req) => {
  const header = req.headers.authorization
  if (!header) throw new Error('No token')
  const decoded = jwt.verify(header.split(' ')[1])
  return { valid: true, user: decoded }
}))

module.exports = router
