const { MongoClient } = require('mongodb')

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/plume'
const client = new MongoClient(MONGO_URI, {
  serverSelectionTimeoutMS: process.env.NODE_ENV === 'test' ? 1000 : 30000,
  connectTimeoutMS: process.env.NODE_ENV === 'test' ? 1000 : 30000
})

function createDummyCollection() {
  const docs = []
  return {
    find: (query = {}) => {
      let filtered = docs.filter(d => {
        for (const [k, v] of Object.entries(query)) {
          if (d[k] !== v) return false
        }
        return true
      })
      return {
        sort: () => ({ limit: (n) => ({ toArray: async () => filtered.slice(0, n) }), toArray: async () => filtered }),
        project: () => ({ toArray: async () => filtered }),
        limit: (n) => ({ toArray: async () => filtered.slice(0, n) }),
        toArray: async () => filtered
      }
    },
    findOne: async (query = {}) => {
      if (!query || Object.keys(query).length === 0) return docs[0] || null
      return docs.find(d => {
        for (const [k, v] of Object.entries(query)) {
          if (d[k] !== v) return false
        }
        return true
      }) || null
    },
    insertOne: async (doc) => {
      docs.push(doc)
      return { insertedId: doc._id || 'mock_id' }
    },
    updateOne: async () => ({ modifiedCount: 1 }),
    replaceOne: async () => ({ modifiedCount: 1 }),
    deleteOne: async (query = {}) => {
      const idx = docs.findIndex(d => {
        for (const [k, v] of Object.entries(query)) {
          if (d[k] !== v) return false
        }
        return true
      })
      if (idx !== -1) docs.splice(idx, 1)
      return { deletedCount: 1 }
    },
    countDocuments: async (query = {}) => {
      if (!query || Object.keys(query).length === 0) return docs.length
      return docs.filter(d => {
        for (const [k, v] of Object.entries(query)) {
          if (d[k] !== v) return false
        }
        return true
      }).length
    },
    createIndex: async () => {}
  }
}

const db = {
  users: createDummyCollection(),
  likes: createDummyCollection(),
  playlists: createDummyCollection(),
  settings: createDummyCollection(),
  searchHist: createDummyCollection(),
  authCodes: createDummyCollection(),
  listeningHist: createDummyCollection(),
  themes: createDummyCollection(),
  stats: createDummyCollection(),
  trackStats: createDummyCollection(),
  apiStats: createDummyCollection()
}

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
      db.apiStats = mdb.collection('api_stats')

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
      db.apiStats.createIndex({ timestamp: 1 })
    })
    .catch(err => {
      console.error('[MongoDB] Connection error:', err.message || err)
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1)
      }
    })
  return connectPromise
}

// Connect immediately so operations are buffered/ready
db.connectPromise = connectDB()
db.client = client

module.exports = db
