const db = require('./database')

async function getAll() {
  return new Promise((resolve, reject) => {
    db.themes.find({}).sort({ downloads: -1 }).exec((err, docs) => {
      if (err) return reject(err)
      resolve(docs || [])
    })
  })
}

async function create(authorId, authorName, name, themeData) {
  const count = await new Promise((resolve, reject) => {
    db.themes.count({ authorId }, (err, c) => err ? reject(err) : resolve(c))
  })
  if (count >= 10) throw new Error('Maximum themes per user reached (10)')

  const doc = {
    authorId,
    authorName,
    name,
    themeData,
    downloads: 0,
    createdAt: new Date()
  }
  return new Promise((resolve, reject) => {
    db.themes.insert(doc, (err, newDoc) => {
      if (err) return reject(err)
      resolve(newDoc)
    })
  })
}

async function incrementDownloads(id) {
  return new Promise((resolve, reject) => {
    db.themes.update({ _id: id }, { $inc: { downloads: 1 } }, {}, (err, num) => {
      if (err) return reject(err)
      resolve(num)
    })
  })
}

module.exports = { getAll, create, incrementDownloads }
