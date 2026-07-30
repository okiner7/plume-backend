const db = require('./database')
const crypto = require('crypto')

function genId() { return crypto.randomBytes(8).toString('hex') }

async function getAll(ownerId) {
  return await db.playlists.find({ ownerId }).sort({ createdAt: -1 }).toArray()
}

async function create(ownerId, name) {
  const count = await db.playlists.countDocuments({ ownerId })
  if (count >= 50) throw new Error('Maximum playlists limit reached (50)')

  const doc = {
    _id: genId(),
    ownerId,
    name,
    tracks: [],
    createdAt: new Date(),
    updatedAt: new Date()
  }
  
  await db.playlists.insertOne(doc)
  return doc
}

async function rename(playlistId, ownerId, newName) {
  return await db.playlists.updateOne(
    { _id: playlistId, ownerId }, 
    { $set: { name: newName, updatedAt: new Date() } }
  )
}

async function remove(playlistId, ownerId) {
  return await db.playlists.deleteOne({ _id: playlistId, ownerId })
}

async function addTrack(playlistId, ownerId, track) {
  const pl = await getOne(playlistId)
  if (!pl) throw new Error('Playlist not found')
  if (pl.ownerId !== ownerId) throw new Error('Forbidden')

  const res = await db.playlists.updateOne(
    { _id: playlistId, ownerId, 'tracks.499': { $exists: false } },
    { $push: { tracks: track }, $set: { updatedAt: new Date() } }
  )
  if (!res || res.matchedCount === 0) {
    throw new Error('Playlist is full (max 500 tracks)')
  }
  return true
}

async function removeTrack(playlistId, ownerId, trackId, source) {
  await ensurePlaylistExists(playlistId, ownerId)
  await db.playlists.updateOne(
    { _id: playlistId, ownerId },
    { $pull: { tracks: { id: trackId, source } }, $set: { updatedAt: new Date() } }
  )
  return true
}

async function getOne(playlistId) {
  return await db.playlists.findOne({ _id: playlistId })
}

async function ensurePlaylistExists(playlistId, ownerId) {
  const pl = await getOne(playlistId)
  if (!pl) throw new Error('Playlist not found')
  if (pl.ownerId !== ownerId) throw new Error('Forbidden')
}

module.exports = { getAll, create, rename, remove, addTrack, removeTrack, getOne }
