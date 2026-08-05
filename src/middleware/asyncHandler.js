module.exports = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next))
    .then(data => {
      if (!res.headersSent && data !== undefined) {
        res.json({ success: true, data })
      }
    })
    .catch(next)
