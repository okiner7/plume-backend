const axios = require('axios')
const { getProxyStats, markProxyFailed, markProxySuccess } = require('../../src/middleware/proxyManager')
const telegramBot = require('../bot/telegramBot')

// URL для проверки — легкий запрос к SC API
const CHECK_URL = 'https://api-v2.soundcloud.com/resolve?url=https://soundcloud.com/skrillex'
const CHECK_TIMEOUT = 10000

let healthCheckInterval = null

// Статус каждого прокси: index → { wasHealthy: bool }
const proxyStates = {}

// Общий флаг — хотя бы один прокси живой
let overallHealthy = true

async function checkSingleProxy(proxy) {
  const { HttpsProxyAgent } = require('https-proxy-agent')
  let agent
  try {
    agent = new HttpsProxyAgent(proxy._url) // используем внутренний url из stats
  } catch {
    return { ok: false, error: 'Invalid proxy URL' }
  }

  try {
    const res = await axios.get(CHECK_URL, {
      httpsAgent: agent,
      timeout: CHECK_TIMEOUT,
      proxy: false,
      validateStatus: () => true
    })

    // 5xx — сервер упал, не прокси
    // 403/429 — прокси заблокирован SC
    if (res.status === 403 || res.status === 429) {
      return { ok: false, error: `SC blocked proxy (${res.status})`, agent }
    }
    if (res.status >= 500) {
      // SC сам упал — не считаем прокси виноватым
      return { ok: true, warn: `SC returned ${res.status}` }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message, agent }
  }
}

async function checkAll() {
  const { getProxyStats, markProxyFailed, markProxySuccess, _pool } = require('../../src/middleware/proxyManager')
  const stats = getProxyStats()
  if (stats.total === 0) return

  // Проверяем каждый прокси параллельно
  const results = await Promise.allSettled(
    stats.proxies.map(p => checkSingleProxy(p))
  )

  let newFails = 0
  let newRecoveries = 0

  results.forEach((result, i) => {
    const proxy = stats.proxies[i]
    const wasInCooldown = proxy.status.startsWith('cooldown')

    if (result.status === 'rejected' || !result.value?.ok) {
      const err = result.value?.error || result.reason?.message || 'unknown'
      newFails++

      // Помечаем в пуле если не в cooldown уже
      if (!wasInCooldown && result.value?.agent) {
        // Принудительно добавляем страйк через markFailed
        for (let s = 0; s < 5; s++) markProxyFailed(result.value.agent)
      }

      console.warn(`[ProxyHealth] ❌ Proxy #${i} (${proxy.url}) — ${err}`)
    } else {
      if (wasInCooldown) newRecoveries++
      if (result.value.warn) {
        console.warn(`[ProxyHealth] ⚠️  Proxy #${i} — ${result.value.warn}`)
      }
    }
  })

  const freshStats = getProxyStats()
  const activeCount = freshStats.proxies.filter(p => !p.status.startsWith('cooldown')).length
  const cooldownCount = freshStats.total - activeCount

  // Все в cooldown — тревога
  if (activeCount === 0 && freshStats.total > 0) {
    if (overallHealthy) {
      overallHealthy = false
      telegramBot.sendAdminAlert(
        `🛑 *Все прокси недоступны!*\n` +
        `Все ${freshStats.total} прокси заблокированы или недоступны.\n` +
        `Пользователи испытывают проблемы с музыкой.\n\n` +
        `*Статус пула:*\n` +
        freshStats.proxies.map(p => `• \`${p.url}\` — ${p.status}`).join('\n')
      )
    }
    console.error('[ProxyHealth] 🚨 ALL proxies DOWN!')
    return
  }

  // Восстановление
  if (!overallHealthy && activeCount > 0) {
    overallHealthy = true
    telegramBot.sendAdminAlert(
      `✅ *Прокси восстановлены*\n` +
      `${activeCount} из ${freshStats.total} прокси снова работают.`
    )
    console.log('[ProxyHealth] ✅ Pool recovered!')
  }

  console.log(
    `[ProxyHealth] Pool: ${activeCount}/${freshStats.total} active` +
    (cooldownCount ? `, ${cooldownCount} in cooldown` : '') +
    (newFails ? `, ${newFails} failed this check` : '')
  )
}

function isHealthy() {
  const stats = getProxyStats()
  if (stats.total === 0) return true // нет прокси — не наша проблема
  const activeCount = stats.proxies.filter(p => !p.status.startsWith('cooldown')).length
  return activeCount > 0
}

function start(intervalMs = 5 * 60 * 1000) {
  if (healthCheckInterval) clearInterval(healthCheckInterval)
  checkAll()
  healthCheckInterval = setInterval(checkAll, intervalMs)
  console.log(`[ProxyHealth] Started — checking pool every ${intervalMs / 60000} min`)
}

function stop() {
  if (healthCheckInterval) clearInterval(healthCheckInterval)
  healthCheckInterval = null
}

function getStatus() {
  return isHealthy()
}

module.exports = { start, stop, getStatus, isHealthy: getStatus }
