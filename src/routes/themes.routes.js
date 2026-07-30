const { Router } = require('express')
const asyncHandler = require('../middleware/asyncHandler')
const authRequired = require('../middleware/authRequired')
const themeStore = require('../services/storage/themeStore')
const { validateBody } = require('../middleware/validate')
const { createThemeSchema, downloadThemeSchema, postThemeSchema } = require('../schemas/theme.schema')

const router = Router()

// Public endpoint to get all themes
router.get('/', asyncHandler(async (req, res) => {
  const themes = await themeStore.getAll()
  return themes
}))

// Protected endpoint to publish a theme
router.post('/', authRequired, validateBody(postThemeSchema), asyncHandler(async (req) => {
  // LNX-2026-009 Fix: sanitize length and types
  const name = String(req.body.name || '').trim().slice(0, 100)
  const themeData = req.body.themeData
  if (!name || !themeData || typeof themeData !== 'object') {
    throw new Error('Valid name and themeData object are required')
  }
  if (JSON.stringify(themeData).length > 50000) {
    throw new Error('Theme payload size exceeds limit (50KB)')
  }
  
  const authorId = `${req.user.provider}_${req.user.provider_id}`
  const authorName = String(req.user.name || 'Аноним').trim().slice(0, 100)
  
  return await themeStore.create(authorId, authorName, name, themeData)
}))

// LNX-2026-026: rate-limit theme download counter — max 10 increments per IP per minute
const rateLimit = require('express-rate-limit')
const downloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many requests' }
})
router.post('/:id/download', downloadLimiter, validateBody(downloadThemeSchema), asyncHandler(async (req) => {
  const id = String(req.params.id)
  await themeStore.incrementDownloads(id)
  return { success: true }
}))

module.exports = router
