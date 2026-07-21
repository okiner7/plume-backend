const { Telegraf } = require('telegraf')
const { TELEGRAM_BOT_TOKEN, DEV_TELEGRAM_IDS } = require('../../src/config/env')
const authCodeStore = require('../storage/authCodeStore')
const NodeCache = require('node-cache')

const rateLimitCache = new NodeCache({ stdTTL: 5, checkperiod: 5 })
const loginCooldownCache = new NodeCache({ stdTTL: 300, checkperiod: 60 })
let bot = null

function start() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[TG Bot] No token, skipping')
    return
  }

  bot = new Telegraf(TELEGRAM_BOT_TOKEN)

  // Anti-spam middleware for Telegram Bot
  bot.use((ctx, next) => {
    if (!ctx.from) return next()
    const id = String(ctx.from.id)

    // Ignore all messages if user is in 5-minute login cooldown
    if (loginCooldownCache.has(id)) return

    const count = rateLimitCache.get(id) || 0
    if (count >= 3) {
      if (count === 3) {
        rateLimitCache.set(id, count + 1)
        return ctx.reply('⚠️ Полегче! Не спамь командами. Подожди пару секунд.')
      }
      return // Silently drop spam
    }
    rateLimitCache.set(id, count + 1)
    return next()
  })

  bot.start((ctx) => {
    ctx.reply(
      'Добро пожаловать в Lunex!\n\n'
      + 'Чтобы войти, отправь /login'
    )
  })

  bot.command('login', async (ctx) => {
    const telegramId = String(ctx.from.id)
    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || `tg_${telegramId}`
    let avatar = null

    try {
      const photos = await ctx.telegram.getUserProfilePhotos(telegramId, { limit: 1 })
      if (photos.total_count > 0) {
        const fileId = photos.photos[0][0].file_id
        const file = await ctx.telegram.getFile(fileId)
        // LNX-2026-007 fix: сохраняем только file_path, без токена бота в URL
        // URL с токеном генерируется динамически на бэкенде в /me роуте
        avatar = file.file_path || null
      }
    } catch (err) {
      console.warn('[TG Bot] Could not fetch avatar:', err.message)
    }

    try {
      const codeDoc = await authCodeStore.create(telegramId, name, avatar)
      ctx.replyWithMarkdown(
        'Твой код для входа в Lunex:\n\n'
        + `\`${codeDoc.code}\`\n\n`
        + 'Вставь его в приложении. Код действителен 5 минут.'
      )
      // Ignore user for 5 minutes after giving the code
      loginCooldownCache.set(telegramId, true)
    } catch (err) {
      console.error('[TG Bot] Error creating code:', err)
      ctx.reply('Произошла ошибка, попробуй ещё раз.')
    }
  })

  bot.launch()
  console.log('[TG Bot] Polling started successfully')
}

function stop() {
  if (bot) {
    bot.stop('SIGINT')
    bot = null
    console.log('[TG Bot] Stopped')
  }
}

async function sendAdminAlert(message) {
  if (!bot || !DEV_TELEGRAM_IDS || !DEV_TELEGRAM_IDS.length) return
  
  for (const adminId of DEV_TELEGRAM_IDS) {
    try {
      await bot.telegram.sendMessage(adminId, `🚨 *Lunex Alert*\n\n${message}`, { parse_mode: 'Markdown' })
    } catch (err) {
      console.warn(`[TG Bot] Failed to send alert to admin ${adminId}:`, err.message)
    }
  }
}

module.exports = { start, stop, sendAdminAlert }
