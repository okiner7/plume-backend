const db = require('./database')
const statsStore = require('./statsStore')

const MAX_HISTORY = 50

async function getRecent(userId, limit = 50) {
  return new Promise((resolve, reject) => {
    db.listeningHist.find({ userId }).sort({ playedAt: -1 }).limit(limit).exec((err, docs) => {
      if (err) return reject(err)
      resolve((docs || []).map(d => ({
        id: d.id,
        source: d.source,
        title: d.title,
        artist: d.artist,
        artwork: d.artwork,
        duration: d.duration,
        playedAt: d.playedAt
      })))
    })
  })
}

async function add(userId, track) {
  const doc = {
    userId,
    id: track.id,
    source: track.source,
    title: track.title,
    artist: track.artist,
    artwork: track.artwork,
    duration: track.duration,
    playedAt: new Date()
  }
  return new Promise((resolve, reject) => {
    db.listeningHist.insert(doc, async (err) => {
      if (err) return reject(err)
      await trim(userId)
      await statsStore.incrementListenCount().catch(console.error)
      await statsStore.incrementTrackPlay(track).catch(console.error)
      const userStore = require('./userStore')
      await userStore.incrementUserStat(userId, 'totalListens').catch(console.error)
      resolve(doc)
    })
  })
}

async function trim(userId) {
  return new Promise((resolve, reject) => {
    db.listeningHist.find({ userId }).sort({ playedAt: -1 }).skip(MAX_HISTORY).exec((err, docs) => {
      if (err) return reject(err)
      const ids = docs.map(d => d._id)
      if (ids.length === 0) return resolve()
      db.listeningHist.remove({ _id: { $in: ids } }, { multi: true }, (err2) => {
        if (err2) return reject(err2)
        resolve()
      })
    })
  })
}

async function clear(userId) {
  return new Promise((resolve, reject) => {
    db.listeningHist.remove({ userId }, { multi: true }, (err, num) => {
      if (err) return reject(err)
      resolve(num)
    })
  })
}

module.exports = { getRecent, add, clear }
