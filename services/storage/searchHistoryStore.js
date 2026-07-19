const db = require('./database')
const statsStore = require('./statsStore')

const MAX_HISTORY = 50

async function getRecent(userId, limit = 10) {
  return new Promise((resolve, reject) => {
    db.searchHist.find({ userId }).sort({ createdAt: -1 }).limit(limit).exec((err, docs) => {
      if (err) return reject(err)
      resolve((docs || []).map(d => ({ query: d.query, createdAt: d.createdAt })))
    })
  })
}

async function add(userId, query) {
  const doc = { userId, query, createdAt: new Date() }
  return new Promise((resolve, reject) => {
    db.searchHist.insert(doc, async (err) => {
      if (err) return reject(err)
      await trim(userId)
      await statsStore.incrementSearchCount().catch(console.error)
      const userStore = require('./userStore')
      await userStore.incrementUserStat(userId, 'totalSearches').catch(console.error)
      const recent = await getRecent(userId, 10)
      resolve(recent)
    })
  })
}

async function trim(userId) {
  return new Promise((resolve, reject) => {
    db.searchHist.find({ userId }).sort({ createdAt: -1 }).skip(MAX_HISTORY).exec((err, docs) => {
      if (err) return reject(err)
      const ids = docs.map(d => d._id)
      if (ids.length === 0) return resolve()
      db.searchHist.remove({ _id: { $in: ids } }, { multi: true }, (err2) => {
        if (err2) return reject(err2)
        resolve()
      })
    })
  })
}

async function clear(userId) {
  return new Promise((resolve, reject) => {
    db.searchHist.remove({ userId }, { multi: true }, (err, num) => {
      if (err) return reject(err)
      resolve(num)
    })
  })
}

module.exports = { getRecent, add, clear }
