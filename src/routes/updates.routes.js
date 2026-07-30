const { Router } = require('express')
const path = require('path')
const fs = require('fs')
const updatesStore = require('../services/storage/updatesStore')

const router = Router()

// GET /api/updates/latest?platform=windows&channel=stable
router.get('/latest', (req, res) => {
  const platform = req.query.platform || 'windows'
  const channel = req.query.channel || 'stable'
  const update = updatesStore.getUpdate(platform, channel)

  if (!update) {
    return res.status(404).json({ success: false, error: 'No updates found for this platform and channel' })
  }

  // Determine the full URL based on the backend URL
  const backendUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`
  const downloadUrl = `${backendUrl}/api/updates/download/${update.filename}`
  const blockmapUrl = update.blockmap ? `${backendUrl}/api/updates/download/${update.blockmap}` : undefined

  return res.json({
    success: true,
    version: update.version,
    releaseNotes: update.releaseNotes,
    mandatory: !!update.mandatory,
    sha256: update.sha256,
    url: downloadUrl,
    blockmap: blockmapUrl,
    uploadDate: update.uploadDate
  })
})

// GET /api/updates/download/:filename
router.get('/download/:filename', (req, res) => {
  const allUpdates = updatesStore.getUpdates()
  let matchedUpdate = null
  for (const platformData of Object.values(allUpdates || {})) {
    for (const channelUpdates of Object.values(platformData || {})) {
      if (Array.isArray(channelUpdates)) {
        const found = channelUpdates.find(u => u.filename === req.params.filename)
        if (found) {
          matchedUpdate = found
          break
        }
      }
    }
    if (matchedUpdate) break
  }

  if (!matchedUpdate) {
    return res.status(404).json({ success: false, error: 'File not found in update registry' })
  }

  const filePath = path.join(process.cwd(), 'data', 'updates', req.params.filename)
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'Update file is missing on the server' })
  }

  res.download(filePath, matchedUpdate.filename)
})

module.exports = router
