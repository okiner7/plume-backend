require('dotenv').config()
const jwt = require('jsonwebtoken')

const ids = (process.env.DEV_TELEGRAM_IDS || '').split(',').filter(Boolean)

if (ids.length === 0) {
  console.error('\n[Ошибка] В .env нет DEV_TELEGRAM_IDS!')
  console.error('Сначала добавь свой ID: DEV_TELEGRAM_IDS=123456\n')
  process.exit(1)
}

const adminId = ids[0]

const token = jwt.sign(
  { provider: 'telegram', provider_id: adminId }, 
  process.env.JWT_SECRET,
  { expiresIn: '7d' } // Живёт 7 дней
)

console.log('\n=======================================')
console.log('         LUNEX ADMIN TOKEN             ')
console.log('=======================================\n')
console.log('Ваш токен (скопируйте и вставьте в админ-панель):\n')
console.log(token)
console.log('\nAPP_SECRET:\n')
console.log(process.env.APP_SECRET)
console.log('\n=======================================\n')
