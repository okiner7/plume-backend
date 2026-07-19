const db = require('./database')

function buildUserId(provider, providerId) {
  return `${provider}_${providerId}`
}

async function findOrCreate(provider, providerId, profile) {
  let user = await findOne(providerId)
  if (!user) {
    const doc = {
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
    const newDoc = await insert(doc)
    return { ...newDoc, userId: buildUserId(provider, providerId) }
  }
  await update(user._id, { lastLoginAt: new Date(), lastActiveAt: new Date(), name: profile.name || user.name, avatar: profile.avatar || user.avatar })
  return { ...user, ...profile, userId: buildUserId(provider, providerId) }
}

async function findOne(providerId) {
  return new Promise((resolve, reject) => {
    db.users.findOne({ providerId }, (err, doc) => {
      if (err) return reject(err)
      resolve(doc || null)
    })
  })
}

async function insert(doc) {
  return new Promise((resolve, reject) => {
    db.users.insert(doc, (err, newDoc) => {
      if (err) return reject(err)
      resolve(newDoc)
    })
  })
}

async function update(id, fields) {
  return new Promise((resolve, reject) => {
    db.users.update({ _id: id }, { $set: fields }, {}, (err, num) => {
      if (err) return reject(err)
      resolve(num)
    })
  })
}

async function findByProviderId(providerId) {
  return findOne(providerId)
}

async function incrementUserStat(userIdOrProviderId, statField) {
  const parts = userIdOrProviderId.split('_')
  const pid = parts.length > 1 ? parts.slice(1).join('_') : userIdOrProviderId
  
  const user = await new Promise(resolve => {
    db.users.findOne({ $or: [{ providerId: pid }, { userId: userIdOrProviderId }] }, (err, doc) => resolve(doc))
  })
  if (!user) return
  
  if (user[statField] === undefined) {
    // Initialize based on current history length
    const fullUserId = user.userId || buildUserId(user.provider, user.providerId)
    const count = await new Promise(resolve => {
      if (statField === 'totalListens') db.listeningHist.count({ userId: fullUserId }, (err, c) => resolve(c || 0))
      else if (statField === 'totalSearches') db.searchHist.count({ userId: fullUserId }, (err, c) => resolve(c || 0))
      else resolve(0)
    })
    await new Promise(resolve => {
      const setObj = {}; setObj[statField] = count;
      db.users.update({ _id: user._id }, { $set: setObj }, {}, () => resolve())
    })
  }

  const incObj = {}
  incObj[statField] = 1
  return new Promise((resolve, reject) => {
    db.users.update({ _id: user._id }, { $inc: incObj }, {}, (err, num) => {
      if (err) return reject(err)
      resolve(num)
    })
  })
}

async function setBanStatus(id, banned) {
  const user = await new Promise(resolve => {
    db.users.findOne({ $or: [{ providerId: id }, { userId: id }] }, (err, doc) => resolve(doc))
  })
  if (!user) throw new Error('User not found')
  await update(user._id, { banned })
}

// Throttle lastActiveAt updates (max once per 5 mins per user in memory)
const activeUpdateCache = new Set()

async function updateLastActive(providerId, platform = 'unknown') {
  if (activeUpdateCache.has(providerId)) return
  activeUpdateCache.add(providerId)
  setTimeout(() => activeUpdateCache.delete(providerId), 5 * 60 * 1000)
  
  const user = await findOne(providerId)
  if (user) {
    await update(user._id, { lastActiveAt: new Date(), lastPlatform: platform })
  }
}

async function countActiveUsers() {
  return new Promise((resolve, reject) => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    db.users.find({ lastActiveAt: { $gte: oneDayAgo } }, (err, docs) => {
      if (err) return reject(err)
      
      const counts = { windows: 0, linux: 0, android: 0, unknown: 0 }
      for (const doc of docs) {
        const plat = doc.lastPlatform || 'unknown'
        if (counts[plat] !== undefined) {
          counts[plat]++
        } else {
          counts.unknown++
        }
      }
      resolve(counts)
    })
  })
}

async function getBadges(providerId) {
  const user = await findOne(providerId)
  return user ? user.badges || [] : []
}

async function addBadge(providerId, badge) {
  const user = await findOne(providerId)
  if (!user) return
  const exists = user.badges && user.badges.find(b => b.id === badge.id)
  if (exists) return
  const badges = [...(user.badges || []), { ...badge, earnedAt: new Date() }]
  await update(user._id, { badges })
}

async function countAllUsers() {
  return new Promise((resolve, reject) => {
    db.users.find({}, (err, docs) => {
      if (err) return reject(err)
      
      const counts = { windows: 0, linux: 0, android: 0, unknown: 0 }
      for (const doc of docs) {
        const plat = doc.lastPlatform || 'unknown'
        if (counts[plat] !== undefined) {
          counts[plat]++
        } else {
          counts.unknown++
        }
      }
      resolve(counts)
    })
  })
}

async function getRecentUsers(limit = 50) {
  return new Promise((resolve, reject) => {
    db.users.find({}).sort({ lastActiveAt: -1 }).limit(limit).exec((err, docs) => {
      if (err) return reject(err)
      resolve(docs.map(doc => ({
        id: doc.providerId,
        name: doc.name || 'Anonymous',
        platform: doc.lastPlatform || 'unknown',
        lastActiveAt: doc.lastActiveAt,
        banned: !!doc.banned
      })))
    })
  })
}

async function getAllUserIds() {
  return new Promise((resolve, reject) => {
    db.users.find({}, { providerId: 1 }, (err, docs) => {
      if (err) return reject(err)
      resolve(docs.map(doc => doc.providerId))
    })
  })
}

async function deleteUser(id) {
  const user = await new Promise(resolve => {
    db.users.findOne({ $or: [{ providerId: id }, { userId: id }] }, (err, doc) => resolve(doc))
  })
  if (!user) throw new Error('User not found')
  
  return new Promise((resolve, reject) => {
    db.users.remove({ _id: user._id }, {}, (err, numRemoved) => {
      if (err) return reject(err)
      resolve(numRemoved)
    })
  })
}

module.exports = { findOrCreate, findOne, findByProviderId, getBadges, addBadge, buildUserId, updateLastActive, countActiveUsers, countAllUsers, getRecentUsers, setBanStatus, getAllUserIds, incrementUserStat, deleteUser }
