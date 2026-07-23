const fs = require('fs')
const path = require('path')

const UPDATES_DIR = path.join(process.cwd(), 'data', 'updates')
const METADATA_FILE = path.join(UPDATES_DIR, 'metadata.json')

class UpdatesStore {
  constructor() {
    this.metadata = {}
    this.init()
  }

  init() {
    if (!fs.existsSync(UPDATES_DIR)) {
      fs.mkdirSync(UPDATES_DIR, { recursive: true })
    }
    if (!fs.existsSync(METADATA_FILE)) {
      this._save()
    } else {
      try {
        this.metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'))
      } catch (err) {
        console.error('[UpdatesStore] Error parsing metadata.json:', err.message)
        this.metadata = {}
      }
    }
  }

  _save() {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(this.metadata, null, 2))
  }

  _reload() {
    if (fs.existsSync(METADATA_FILE)) {
      try {
        this.metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'))
      } catch (err) {
        // keep old metadata if file is locked or corrupted temporarily
      }
    }
  }

  getUpdates() {
    this._reload()
    return this.metadata
  }

  getUpdate(platform) {
    this._reload()
    return this.metadata[platform] || null
  }

  addUpdate(platform, updateData) {
    this.metadata[platform] = {
      ...updateData,
      uploadDate: new Date().toISOString()
    }
    this._save()
  }
}

module.exports = new UpdatesStore()
