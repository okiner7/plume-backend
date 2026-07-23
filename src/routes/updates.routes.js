const { Router } = require('express')
const path = require('path')
const fs = require('fs')
const updatesStore = require('../services/storage/updatesStore')

const router = Router()

// GET /api/updates/latest?platform=windows
router.get('/latest', (req, res) => {
  const platform = req.query.platform || 'windows'
  const update = updatesStore.getUpdate(platform)

  if (!update) {
    return res.status(404).json({ success: false, error: 'No updates found for this platform' })
  }

  // Determine the full URL based on the backend URL
  const backendUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`
  const downloadUrl = `${backendUrl}/api/updates/download/${update.filename}?platform=${platform}`

  return res.json({
    success: true,
    version: update.version,
    releaseNotes: update.releaseNotes,
    mandatory: !!update.mandatory,
    url: downloadUrl,
    uploadDate: update.uploadDate
  })
})

// GET /api/updates/download/:filename?platform=windows
router.get('/download/:filename', (req, res) => {
  const platform = req.query.platform || 'windows'
  const update = updatesStore.getUpdate(platform)

  if (!update || update.filename !== req.params.filename) {
    return res.status(404).json({ success: false, error: 'File not found' })
  }

  const filePath = path.join(process.cwd(), 'data', 'updates', update.filename)
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'Update file is missing on the server' })
  }

  res.download(filePath, update.filename)
})

module.exports = router
