const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
const jwt = require('jsonwebtoken')

const args = process.argv.slice(2)
const emailArg = args.find(a => a.includes('@'))
const idArg = args.find(a => /^\d+$/.test(a))

const tgIds = idArg ? [idArg] : (process.env.DEV_TELEGRAM_IDS || '').split(',').filter(Boolean)
const googleEmails = emailArg ? [emailArg] : (process.env.DEV_EMAILS || '').split(',').filter(Boolean)

if (tgIds.length === 0 && googleEmails.length === 0) {
  console.error('\n[Ошибка] В .env нет ни DEV_TELEGRAM_IDS, ни DEV_EMAILS, и аргументы не переданы!')
  console.error('Пример использования: node scripts/generate-admin-token.js test@gmail.com\n')
  process.exit(1)
}

let payload = {}

if (emailArg || (googleEmails.length > 0 && tgIds.length === 0)) {
  payload = { provider: 'google', email: googleEmails[0] }
} else {
  payload = { provider: 'telegram', provider_id: tgIds[0] }
}

const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production'

const token = jwt.sign(
  payload, 
  secret,
  { expiresIn: '7d' } // Живёт 7 дней
)

console.log('\n=======================================')
console.log('         PLUME ADMIN TOKEN             ')
console.log('=======================================\n')
console.log('Ваш токен (скопируйте и вставьте в админ-панель):\n')
console.log(token)
console.log('\nAPP_SECRET:\n')
console.log(process.env.APP_SECRET)
console.log('\n=======================================\n')
