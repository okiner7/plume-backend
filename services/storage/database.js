const Datastore = require('@seald-io/nedb')
const path = require('path')

const DATA_DIR = path.join(__dirname, '..', '..', 'data')

const db = {}

const isTest = process.env.NODE_ENV === 'test'

function createDb(name) {
  if (isTest) {
    return new Datastore({ inMemoryOnly: true, autoload: true })
  }
  return new Datastore({ filename: path.join(DATA_DIR, `${name}.db`), autoload: true })
}

db.users = createDb('users')
db.likes = createDb('likes')
db.playlists = createDb('playlists')
db.settings = createDb('settings')
db.searchHist = createDb('search_history')
db.authCodes = createDb('auth_codes')
db.listeningHist = createDb('listening_history')
db.themes = createDb('themes')
db.stats = createDb('stats')
db.trackStats = createDb('track_stats')

db.users.ensureIndex({ fieldName: 'providerId', unique: true })
db.likes.ensureIndex({ fieldName: 'userId' })
db.playlists.ensureIndex({ fieldName: 'ownerId' })
db.settings.ensureIndex({ fieldName: 'userId', unique: true })
db.searchHist.ensureIndex({ fieldName: 'userId' })
db.authCodes.ensureIndex({ fieldName: 'code', unique: true })
db.authCodes.ensureIndex({ fieldName: 'telegramId' })
db.listeningHist.ensureIndex({ fieldName: 'userId' })
db.trackStats.ensureIndex({ fieldName: 'id', unique: true })

module.exports = db
