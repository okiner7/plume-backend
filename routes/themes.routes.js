const { Router } = require('express')
const asyncHandler = require('../src/middleware/asyncHandler')
const authRequired = require('../src/middleware/authRequired')
const themeStore = require('../services/storage/themeStore')

const router = Router()

// Public endpoint to get all themes
router.get('/', asyncHandler(async (req, res) => {
  const themes = await themeStore.getAll()
  return themes
}))

// Protected endpoint to publish a theme
router.post('/', authRequired, asyncHandler(async (req) => {
  // LNX-2026-009 Fix: sanitize length and types
  const name = String(req.body.name || '').trim().slice(0, 100)
  const themeData = req.body.themeData
  if (!name || !themeData || typeof themeData !== 'object') {
    throw new Error('Valid name and themeData object are required')
  }
  
  const authorId = `${req.user.provider}_${req.user.provider_id}`
  const authorName = String(req.user.name || 'Аноним').trim().slice(0, 100)
  
  return await themeStore.create(authorId, authorName, name, themeData)
}))

// Public endpoint to increment downloads
router.post('/:id/download', asyncHandler(async (req) => {
  const id = String(req.params.id)
  await themeStore.incrementDownloads(id)
  return { success: true }
}))

module.exports = router
