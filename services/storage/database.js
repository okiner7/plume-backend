const { MongoClient } = require('mongodb')

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lunex'
const client = new MongoClient(MONGO_URI)

const db = {}

let connectPromise = null

async function connectDB() {
  if (connectPromise) return connectPromise
  connectPromise = client.connect()
    .then(() => {
      if (typeof process.env.NODE_APP_INSTANCE === 'undefined' || process.env.NODE_APP_INSTANCE === '0') {
        const total = process.env.instances || 4
        console.log(`[MongoDB] Connected ${total}/${total}`)
      }
      const mdb = client.db()
      
      // Map collections to existing property names
      db.users = mdb.collection('users')
      db.likes = mdb.collection('likes')
      db.playlists = mdb.collection('playlists')
      db.settings = mdb.collection('settings')
      db.searchHist = mdb.collection('search_history')
      db.authCodes = mdb.collection('auth_codes')
      db.listeningHist = mdb.collection('listening_history')
      db.themes = mdb.collection('themes')
      db.stats = mdb.collection('stats')
      db.trackStats = mdb.collection('track_stats')

      // Ensure Indexes
      db.users.createIndex({ providerId: 1 }, { unique: true })
      db.likes.createIndex({ userId: 1 })
      db.playlists.createIndex({ ownerId: 1 })
      db.settings.createIndex({ userId: 1 }, { unique: true })
      db.searchHist.createIndex({ userId: 1 })
      db.authCodes.createIndex({ code: 1 }, { unique: true })
      db.authCodes.createIndex({ telegramId: 1 })
      db.listeningHist.createIndex({ userId: 1 })
      db.trackStats.createIndex({ id: 1 }, { unique: true })
    })
    .catch(err => {
      console.error('[MongoDB] Connection error:', err)
      process.exit(1)
    })
  return connectPromise
}

// Connect immediately so operations are buffered/ready
db.connectPromise = connectDB()
db.client = client

module.exports = db
