const db = require('./database')
const crypto = require('crypto')

function genId() { return crypto.randomBytes(8).toString('hex') }

function buildUserId(provider, providerId) {
  return `${provider}_${providerId}`
}

async function findOrCreate(provider, providerId, profile) {
  let user = await findOne(providerId)
  if (!user) {
    const doc = {
      _id: genId(),
      provider,
      providerId,
      name: profile.name || '',
      email: profile.email || '',
      avatar: profile.avatar || '',
      badges: [],
      createdAt: new Date(),
      lastLoginAt: new Date(),
      banned: false
    }
    if (db.users) await db.users.insertOne(doc)
    return { ...doc, userId: buildUserId(provider, providerId) }
  }
  await update(user._id, { lastLoginAt: new Date(), lastActiveAt: new Date(), name: profile.name || user.name, avatar: profile.avatar || user.avatar })
  return { ...user, ...profile, userId: buildUserId(provider, providerId) }
}

async function findOne(providerId) {
  if (!db.users) return null
  return await db.users.findOne({ providerId })
}

async function update(id, fields) {
  if (!db.users) return
  return await db.users.updateOne({ _id: id }, { $set: fields })
}

async function findByProviderId(providerId) {
  return findOne(providerId)
}

async function incrementUserStat(userIdOrProviderId, statField) {
  const parts = userIdOrProviderId.split('_')
  const pid = parts.length > 1 ? parts.slice(1).join('_') : userIdOrProviderId
  
  const user = await db.users.findOne({ $or: [{ providerId: pid }, { userId: userIdOrProviderId }] })
  if (!user) return
  
  if (user[statField] === undefined) {
    // Initialize based on current history length
    const fullUserId = user.userId || buildUserId(user.provider, user.providerId)
    let count = 0
    if (statField === 'totalListens') {
      count = await db.listeningHist.countDocuments({ userId: fullUserId })
    } else if (statField === 'totalSearches') {
      count = await db.searchHist.countDocuments({ userId: fullUserId })
    }
    const setObj = {}; setObj[statField] = count;
    await db.users.updateOne({ _id: user._id }, { $set: setObj })
  }

  const incObj = {}
  incObj[statField] = 1
  return await db.users.updateOne({ _id: user._id }, { $inc: incObj })
}

async function setBanStatus(id, banned) {
  const user = await db.users.findOne({ $or: [{ providerId: id }, { userId: id }] })
  if (!user) throw new Error('User not found')
  await update(user._id, { banned })
}

// Throttle lastActiveAt updates (max once per 5 mins per user in memory)
const activeUpdateCache = new Map()
const MAX_ACTIVE_CACHE_SIZE = 5000
const ACTIVE_CACHE_TTL_MS = 5 * 60 * 1000

function isRecentlyActive(providerId) {
  const now = Date.now()
  const timestamp = activeUpdateCache.get(providerId)
  if (timestamp && (now - timestamp < ACTIVE_CACHE_TTL_MS)) {
    return true
  }
  if (activeUpdateCache.size >= MAX_ACTIVE_CACHE_SIZE) {
    for (const [key, time] of activeUpdateCache.entries()) {
      if (now - time >= ACTIVE_CACHE_TTL_MS) {
        activeUpdateCache.delete(key)
      }
    }
    if (activeUpdateCache.size >= MAX_ACTIVE_CACHE_SIZE) {
      const oldestKey = activeUpdateCache.keys().next().value
      activeUpdateCache.delete(oldestKey)
    }
  }
  activeUpdateCache.set(providerId, now)
  return false
}

async function updateLastActive(providerId, platform = 'unknown') {
  if (isRecentlyActive(providerId)) return
  
  const user = await findOne(providerId)
  if (user) {
    await update(user._id, { lastActiveAt: new Date(), lastPlatform: platform })
  }
}

async function countActiveUsers() {
  if (!db.users) return { windows: 0, linux: 0, android: 0, unknown: 0 }
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const pipeline = [
    { $match: { lastActiveAt: { $gte: oneDayAgo } } },
    { $group: { _id: '$lastPlatform', count: { $sum: 1 } } }
  ]
  const results = await db.users.aggregate(pipeline).toArray()
  
  const counts = { windows: 0, linux: 0, android: 0, unknown: 0 }
  for (const item of results) {
    const plat = item._id || 'unknown'
    if (counts[plat] !== undefined) {
      counts[plat] = item.count
    } else {
      counts.unknown += item.count
    }
  }
  return counts
}

async function getBadges(providerId) {
  const user = await findOne(providerId)
  return user ? user.badges || [] : []
}

async function addBadge(providerId, badge) {
  const user = await db.users.findOne({ $or: [{ providerId }, { userId: providerId }, { _id: providerId }] })
  if (!user) return
  const exists = user.badges && user.badges.find(b => (typeof b === 'string' ? b === badge.id : b.id === badge.id))
  if (exists) return
  const badges = [...(user.badges || []), { ...badge, earnedAt: new Date() }]
  await update(user._id, { badges })
}

async function removeBadge(providerId, badgeId) {
  const user = await db.users.findOne({ $or: [{ providerId }, { userId: providerId }, { _id: providerId }] })
  if (!user) return
  const badges = (user.badges || []).filter(b => (typeof b === 'string' ? b !== badgeId : b.id !== badgeId))
  await update(user._id, { badges })
}

async function countAllUsers() {
  if (!db.users) return { windows: 0, linux: 0, android: 0, unknown: 0 }
  const pipeline = [
    { $group: { _id: '$lastPlatform', count: { $sum: 1 } } }
  ]
  const results = await db.users.aggregate(pipeline).toArray()
  
  const counts = { windows: 0, linux: 0, android: 0, unknown: 0 }
  for (const item of results) {
    const plat = item._id || 'unknown'
    if (counts[plat] !== undefined) {
      counts[plat] = item.count
    } else {
      counts.unknown += item.count
    }
  }
  return counts
}

async function getRecentUsers(limit = 50) {
  const docs = await db.users.find({}).sort({ lastActiveAt: -1 }).limit(limit).toArray()
  return docs.map(doc => ({
    id: doc.providerId,
    name: doc.name || 'Anonymous',
    platform: doc.lastPlatform || 'unknown',
    lastActiveAt: doc.lastActiveAt,
    banned: !!doc.banned
  }))
}

async function getAllUserIds() {
  const docs = await db.users.find({}).project({ providerId: 1 }).toArray()
  return docs.map(doc => doc.providerId)
}

async function deleteUser(id) {
  const user = await db.users.findOne({ $or: [{ providerId: id }, { userId: id }] })
  if (!user) throw new Error('User not found')
  
  return await db.users.deleteOne({ _id: user._id })
}

module.exports = { findOrCreate, findOne, findByProviderId, getBadges, addBadge, removeBadge, buildUserId, updateLastActive, countActiveUsers, countAllUsers, getRecentUsers, setBanStatus, getAllUserIds, incrementUserStat, deleteUser }
