const db = require('./database')

async function incrementListenCount() {
  await db.stats.updateOne(
    { _id: 'global' },
    { $inc: { totalListens: 1 } },
    { upsert: true }
  )
}

async function incrementSearchCount() {
  await db.stats.updateOne(
    { _id: 'global' },
    { $inc: { totalSearches: 1 } },
    { upsert: true }
  )
}

async function getGlobalStats() {
  if (!db.stats) return { totalListens: 0, totalSearches: 0 }
  const doc = await db.stats.findOne({ _id: 'global' })
  return {
    totalListens: doc ? (doc.totalListens || 0) : 0,
    totalSearches: doc ? (doc.totalSearches || 0) : 0
  }
}

async function incrementTrackPlay(track) {
  await db.trackStats.updateOne(
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
    { upsert: true }
  )
}

async function getTopTracks(limit = 10) {
  return await db.trackStats.find({}).sort({ playCount: -1 }).limit(limit).toArray()
}

async function getTopSearches(limit = 10) {
  if (!db.searchHist) return []
  return await db.searchHist.aggregate([
    { $match: { query: { $exists: true, $ne: null } } },
    { $group: { _id: '$query', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
    { $project: { _id: 0, query: '$_id', count: 1 } }
  ]).toArray()
}

module.exports = { incrementListenCount, incrementSearchCount, getGlobalStats, incrementTrackPlay, getTopTracks, getTopSearches }
