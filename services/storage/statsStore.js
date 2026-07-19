const db = require('./database')

async function incrementListenCount() {
  return new Promise((resolve, reject) => {
    db.stats.update(
      { _id: 'global' },
      { $inc: { totalListens: 1 } },
      { upsert: true },
      (err) => {
        if (err) return reject(err)
        resolve()
      }
    )
  })
}

async function incrementSearchCount() {
  return new Promise((resolve, reject) => {
    db.stats.update(
      { _id: 'global' },
      { $inc: { totalSearches: 1 } },
      { upsert: true },
      (err) => {
        if (err) return reject(err)
        resolve()
      }
    )
  })
}

async function getGlobalStats() {
  return new Promise((resolve, reject) => {
    db.stats.findOne({ _id: 'global' }, (err, doc) => {
      if (err) return reject(err)
      resolve({
        totalListens: doc ? (doc.totalListens || 0) : 0,
        totalSearches: doc ? (doc.totalSearches || 0) : 0
      })
    })
  })
}

async function incrementTrackPlay(track) {
  return new Promise((resolve, reject) => {
    db.trackStats.update(
      { id: track.id },
      { 
        $inc: { playCount: 1 },
        $set: {
          source: track.source,
          title: track.title,
          artist: track.artist,
          artwork: track.artwork,
          duration: track.duration,
          lastPlayedAt: new Date()
        }
      },
      { upsert: true },
      (err) => {
        if (err) return reject(err)
        resolve()
      }
    )
  })
}

async function getTopTracks(limit = 10) {
  return new Promise((resolve, reject) => {
    db.trackStats.find({}).sort({ playCount: -1 }).limit(limit).exec((err, docs) => {
      if (err) return reject(err)
      resolve(docs || [])
    })
  })
}

async function getTopSearches(limit = 10) {
  return new Promise((resolve, reject) => {
    db.searchHist.find({}, (err, docs) => {
      if (err) return reject(err)
      const counts = {}
      for (const d of (docs || [])) {
        if (!d.query) continue
        counts[d.query] = (counts[d.query] || 0) + 1
      }
      const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0, limit)
      resolve(sorted.map(([query, count]) => ({ query, count })))
    })
  })
}

module.exports = { incrementListenCount, incrementSearchCount, getGlobalStats, incrementTrackPlay, getTopTracks, getTopSearches }
