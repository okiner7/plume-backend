const db = require('./database')

async function getAll(ownerId) {
  return new Promise((resolve, reject) => {
    db.playlists.find({ ownerId }).sort({ createdAt: -1 }).exec((err, docs) => {
      if (err) return reject(err)
      resolve(docs || [])
    })
  })
}

async function create(ownerId, name) {
  const count = await new Promise((resolve, reject) => {
    db.playlists.count({ ownerId }, (err, c) => err ? reject(err) : resolve(c))
  })
  if (count >= 50) throw new Error('Maximum playlists limit reached (50)')

  const doc = {
    ownerId,
    name,
    tracks: [],
    createdAt: new Date(),
    updatedAt: new Date()
  }
  return new Promise((resolve, reject) => {
    db.playlists.insert(doc, (err, newDoc) => {
      if (err) return reject(err)
      resolve(newDoc)
    })
  })
}

async function rename(playlistId, ownerId, newName) {
  return new Promise((resolve, reject) => {
    db.playlists.update({ _id: playlistId, ownerId }, { $set: { name: newName, updatedAt: new Date() } }, {}, (err, num) => {
      if (err) return reject(err)
      resolve(num)
    })
  })
}

async function remove(playlistId, ownerId) {
  return new Promise((resolve, reject) => {
    db.playlists.remove({ _id: playlistId, ownerId }, {}, (err, num) => {
      if (err) return reject(err)
      resolve(num)
    })
  })
}

async function addTrack(playlistId, ownerId, track) {
  const pl = await getOne(playlistId)
  if (!pl) throw new Error('Playlist not found')
  if (pl.ownerId !== ownerId) throw new Error('Forbidden')
  if (pl.tracks && pl.tracks.length >= 500) throw new Error('Playlist is full (max 500 tracks)')

  return new Promise((resolve, reject) => {
    db.playlists.update(
      { _id: playlistId, ownerId },
      { $push: { tracks: track }, $set: { updatedAt: new Date() } },
      {},
      (err) => {
        if (err) return reject(err)
        resolve(true)
      }
    )
  })
}

async function removeTrack(playlistId, ownerId, trackId, source) {
  await ensurePlaylistExists(playlistId, ownerId)
  return new Promise((resolve, reject) => {
    db.playlists.update(
      { _id: playlistId, ownerId },
      { $pull: { tracks: { id: trackId, source } }, $set: { updatedAt: new Date() } },
      {},
      (err) => {
        if (err) return reject(err)
        resolve(true)
      }
    )
  })
}

async function getOne(playlistId) {
  return new Promise((resolve, reject) => {
    db.playlists.findOne({ _id: playlistId }, (err, doc) => {
      if (err) return reject(err)
      resolve(doc || null)
    })
  })
}

async function ensurePlaylistExists(playlistId, ownerId) {
  const pl = await getOne(playlistId)
  if (!pl) throw new Error('Playlist not found')
  if (pl.ownerId !== ownerId) throw new Error('Forbidden')
}

module.exports = { getAll, create, rename, remove, addTrack, removeTrack, getOne }
