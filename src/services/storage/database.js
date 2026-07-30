const { MongoClient } = require('mongodb')

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/plume'
const client = new MongoClient(MONGO_URI, {
  serverSelectionTimeoutMS: process.env.NODE_ENV === 'test' ? 1000 : 30000,
  connectTimeoutMS: process.env.NODE_ENV === 'test' ? 1000 : 30000
})

const crypto = require('crypto')

function matchDummyQuery(d, query) {
  for (const [k, v] of Object.entries(query)) {
    if (k === '$or' && Array.isArray(v)) {
      const anyMatch = v.some(subQ => matchDummyQuery(d, subQ))
      if (!anyMatch) return false
      continue
    }
    if (k.includes('.')) {
      const parts = k.split('.')
      let val = d
      for (const part of parts) {
        val = val ? val[part] : undefined
      }
      if (v && typeof v === 'object' && v.$exists !== undefined) {
        const exists = val !== undefined
        if (exists !== v.$exists) return false
      } else if (val !== v) {
        return false
      }
    } else if (v && typeof v === 'object') {
      if (v.$gte !== undefined && !(d[k] >= v.$gte)) return false
      if (v.$ne !== undefined && d[k] === v.$ne) return false
      if (v.$exists !== undefined && ((d[k] !== undefined) !== v.$exists)) return false
    } else if (d[k] !== v) {
      return false
    }
  }
  return true
}

function createDummyCollection() {
  const docs = []
  return {
    find: (query = {}) => {
      let filtered = docs.filter(d => matchDummyQuery(d, query))
      return {
        sort: () => ({ limit: (n) => ({ toArray: async () => filtered.slice(0, n) }), toArray: async () => filtered }),
        project: () => ({ toArray: async () => filtered }),
        limit: (n) => ({ toArray: async () => filtered.slice(0, n) }),
        toArray: async () => filtered
      }
    },
    findOne: async (query = {}) => {
      if (!query || Object.keys(query).length === 0) return docs[0] || null
      return docs.find(d => matchDummyQuery(d, query)) || null
    },
    insertOne: async (doc) => {
      if (!doc._id) {
        doc._id = crypto.randomBytes(8).toString('hex')
      }
      docs.push(doc)
      return { insertedId: doc._id }
    },
    updateOne: async (query = {}, updateDoc = {}) => {
      const doc = docs.find(d => matchDummyQuery(d, query))
      if (!doc) return { matchedCount: 0, modifiedCount: 0 }
      if (updateDoc.$set) {
        for (const [k, v] of Object.entries(updateDoc.$set)) {
          doc[k] = v
        }
      }
      if (updateDoc.$inc) {
        for (const [k, v] of Object.entries(updateDoc.$inc)) {
          doc[k] = (doc[k] || 0) + v
        }
      }
      if (updateDoc.$push) {
        for (const [k, v] of Object.entries(updateDoc.$push)) {
          if (!Array.isArray(doc[k])) doc[k] = []
          doc[k].push(v)
        }
      }
      if (updateDoc.$pull) {
        for (const [k, v] of Object.entries(updateDoc.$pull)) {
          if (Array.isArray(doc[k])) {
            doc[k] = doc[k].filter(item => {
              if (typeof v === 'object' && v !== null) {
                for (const [subK, subV] of Object.entries(v)) {
                  if (item[subK] !== subV) return true
                }
                return false
              }
              return item !== v
            })
          }
        }
      }
      return { matchedCount: 1, modifiedCount: 1 }
    },
    replaceOne: async () => ({ matchedCount: 1, modifiedCount: 1 }),
    deleteOne: async (query = {}) => {
      const idx = docs.findIndex(d => matchDummyQuery(d, query))
      if (idx !== -1) docs.splice(idx, 1)
      return { deletedCount: 1 }
    },
    countDocuments: async (query = {}) => {
      if (!query || Object.keys(query).length === 0) return docs.length
      return docs.filter(d => matchDummyQuery(d, query)).length
    },
    aggregate: (pipeline = []) => {
      let result = [...docs]
      for (const stage of pipeline) {
        if (stage.$match) {
          result = result.filter(d => matchDummyQuery(d, stage.$match))
        } else if (stage.$group) {
          const fieldExpr = stage.$group._id
          const fieldName = typeof fieldExpr === 'string' ? fieldExpr.replace('$', '') : null
          const groups = {}
          for (const d of result) {
            const key = fieldName ? (d[fieldName] !== undefined ? d[fieldName] : 'unknown') : 'global'
            if (!groups[key]) {
              groups[key] = { _id: key, count: 0 }
            }
            if (stage.$group.count && stage.$group.count.$sum) {
              groups[key].count += stage.$group.count.$sum
            }
          }
          result = Object.values(groups)
        } else if (stage.$sort) {
          const [sortField, dir] = Object.entries(stage.$sort)[0] || []
          if (sortField) {
            result.sort((a, b) => dir < 0 ? ((b[sortField] || 0) - (a[sortField] || 0)) : ((a[sortField] || 0) - (b[sortField] || 0)))
          }
        } else if (stage.$limit) {
          result = result.slice(0, stage.$limit)
        } else if (stage.$project) {
          result = result.map(d => {
            const projected = {}
            for (const [k, v] of Object.entries(stage.$project)) {
              if (v === 1 && d[k] !== undefined) projected[k] = d[k]
              else if (typeof v === 'string' && v.startsWith('$')) {
                const srcField = v.slice(1)
                if (d[srcField] !== undefined) projected[k] = d[srcField]
              }
            }
            return projected
          })
        }
      }
      return { toArray: async () => result }
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
