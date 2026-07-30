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

  async _saveAsync() {
    try {
      await fs.promises.mkdir(UPDATES_DIR, { recursive: true })
      await fs.promises.writeFile(METADATA_FILE, JSON.stringify(this.metadata, null, 2))
    } catch (err) {
      console.error('[UpdatesStore] Error saving metadata:', err.message)
    }
  }

  _save() {
    this._saveAsync().catch(() => {})
  }

  _reload() {
    try {
      if (fs.existsSync(METADATA_FILE)) {
        const rawStr = fs.readFileSync(METADATA_FILE, 'utf-8')
        const raw = JSON.parse(rawStr)
        const newMeta = {}
        for (const [platform, data] of Object.entries(raw)) {
          if (data.version && typeof data.version === 'string') {
            newMeta[platform] = { stable: [data] }
          } else {
            newMeta[platform] = data
          }
        }
        this.metadata = newMeta
      }
    } catch (err) {
      // keep old metadata if file is locked or corrupted temporarily
    }
  }

  getUpdates() {
    this._reload()
    return this.metadata
  }

  getUpdate(platform, channel = 'stable') {
    this._reload()
    const platformData = this.metadata[platform]
    if (!platformData || !platformData[channel] || platformData[channel].length === 0) {
      return null
    }
    // Return the latest update (first element or last element? Let's say index 0 is the newest)
    return platformData[channel][0]
  }

  addUpdate(platform, channel = 'stable', updateData) {
    this._reload()
    if (!this.metadata[platform]) {
      this.metadata[platform] = {}
    }
    if (!this.metadata[platform][channel]) {
      this.metadata[platform][channel] = []
    }
    
    // Check if version already exists, if so, remove it to overwrite
    this.metadata[platform][channel] = this.metadata[platform][channel].filter(u => u.version !== updateData.version)
    
    // Add to the beginning of the array (newest first)
    this.metadata[platform][channel].unshift({
      ...updateData,
      uploadDate: new Date().toISOString()
    })
    
    this._save()
  }

  deleteUpdate(platform, channel, version) {
    this._reload()
    if (this.metadata[platform] && this.metadata[platform][channel]) {
      this.metadata[platform][channel] = this.metadata[platform][channel].filter(u => u.version !== version)
      this._save()
    }
  }
}

module.exports = new UpdatesStore()
