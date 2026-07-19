const crypto = require('crypto')
const { TELEGRAM_BOT_TOKEN } = require('../../src/config/env')

function validateAuthData(data) {
  const { hash, ...fields } = data
  if (!hash) return null

  // LNX-2026-011 fix: проверяем auth_date — данные старше 24 часов выбрасываются
  const authDate = parseInt(fields.auth_date, 10)
  if (!authDate || (Date.now() / 1000 - authDate) > 86400) return null

  const checkString = Object.keys(fields)
    .sort()
    .map(key => `${key}=${fields[key]}`)
    .join('\n')

  const secret = crypto.createHash('sha256').update(TELEGRAM_BOT_TOKEN).digest()
  const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex')

  const hmacBuf = Buffer.from(hmac)
  const hashBuf = Buffer.from(hash)
  if (hmacBuf.length !== hashBuf.length || !crypto.timingSafeEqual(hmacBuf, hashBuf)) {
    return null
  }

  return {
    telegramId: String(fields.id),
    username: fields.username || fields.first_name || `tg_${fields.id}`,
    avatar: fields.photo_url || null
  }
}

module.exports = { validateAuthData }
