const fs = require('fs')
const path = require('path')
const { HttpsProxyAgent } = require('https-proxy-agent')

// ─── Proxy Pool Manager ────────────────────────────────────────────────────────
// Поддерживает несколько форматов в proxies.txt:
//   host:port:user:pass   (Webshare / ISP)
//   http://user:pass@host:port
//   http://host:port      (без авторизации)
//   host:port             (без авторизации)
// Каждая строка = один прокси. Пустые строки и # игнорируются.
// ─────────────────────────────────────────────────────────────────────────────

const PROXY_FILE = path.join(__dirname, '..', '..', 'proxies.txt')
const MAX_FAILS   = 5      // после 5 ошибок прокси уходит в cooldown
const COOLDOWN_MS = 5 * 60 * 1000  // 5 минут cooldown

class ProxyPool {
  constructor() {
    this.proxies = []      // { url, agent, fails, cooldownUntil }
    this.cursor  = 0
    this._load()
    this._watchFile()
  }

  _parse(line) {
    line = line.trim()
    if (!line || line.startsWith('#')) return null

    let url
    // Формат: host:port:user:pass
    if (!line.startsWith('http')) {
      const parts = line.split(':')
      if (parts.length === 4) {
        url = `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`
      } else if (parts.length === 2) {
        url = `http://${parts[0]}:${parts[1]}`
      } else {
        return null
      }
    } else {
      url = line
    }

    try {
      return { url, agent: new HttpsProxyAgent(url), fails: 0, cooldownUntil: 0 }
    } catch {
      return null
    }
  }

  _load() {
    try {
      if (!fs.existsSync(PROXY_FILE)) {
        console.warn('[ProxyPool] proxies.txt not found — running without proxy')
        return
      }
      const lines = fs.readFileSync(PROXY_FILE, 'utf8').split('\n')
      const parsed = lines.map(l => this._parse(l)).filter(Boolean)
      if (parsed.length === 0) {
        console.warn('[ProxyPool] No valid proxies found in proxies.txt')
        return
      }
      this.proxies = parsed
      this.cursor  = 0
      console.log(`[ProxyPool] Loaded ${parsed.length} proxies`)
    } catch (e) {
      console.error('[ProxyPool] Load error:', e.message)
    }
  }

  // Hot reload: если изменили proxies.txt — подгружаем без рестарта
  _watchFile() {
    try {
      if (fs.existsSync(PROXY_FILE)) {
        fs.watch(PROXY_FILE, () => {
          console.log('[ProxyPool] proxies.txt changed, reloading...')
          this._load()
        })
      }
    } catch {}
  }

  // Round-robin с пропуском cooldown-прокси
  getAgent() {
    if (this.proxies.length === 0) return null

    const now = Date.now()
    let attempts = 0

    while (attempts < this.proxies.length) {
      const idx = this.cursor % this.proxies.length
      this.cursor++
      attempts++

      const proxy = this.proxies[idx]
      if (proxy.cooldownUntil > now) continue  // в cooldown — пропускаем

      return proxy.agent
    }

    // Все в cooldown — берём наименее проблемный
    const best = [...this.proxies].sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0]
    console.warn('[ProxyPool] All proxies in cooldown, using least-bad one')
    return best?.agent || null
  }

  // Вызвать когда прокси вернул ошибку 403/429/timeout
  markFailed(agent) {
    const proxy = this.proxies.find(p => p.agent === agent)
    if (!proxy) return
    proxy.fails++
    if (proxy.fails >= MAX_FAILS) {
      proxy.cooldownUntil = Date.now() + COOLDOWN_MS
      proxy.fails = 0
      console.warn(`[ProxyPool] Proxy ${proxy.url.replace(/:[^:@]+@/, ':***@')} → cooldown ${COOLDOWN_MS / 1000}s`)
    }
  }

  // Вызвать при успешном запросе
  markSuccess(agent) {
    const proxy = this.proxies.find(p => p.agent === agent)
    if (proxy) proxy.fails = 0
  }

  get count()    { return this.proxies.length }
  get healthy()  { return this.proxies.filter(p => p.cooldownUntil < Date.now()).length }

  getStats() {
    const now = Date.now()
    return this.proxies.map((p, i) => ({
      index: i,
      url: p.url.replace(/:[^:@]+@/, ':***@'),
      _url: p.url, // реальный URL для health checker
      fails: p.fails,
      status: p.cooldownUntil > now ? `cooldown ${Math.round((p.cooldownUntil - now) / 1000)}s` : 'active'
    }))
  }
}

const pool = new ProxyPool()

function getRandomProxyAgent() {
  return pool.getAgent()
}

function markProxyFailed(agent) {
  pool.markFailed(agent)
}

function markProxySuccess(agent) {
  pool.markSuccess(agent)
}

function getProxyStats() {
  return { total: pool.count, healthy: pool.healthy, proxies: pool.getStats() }
}

module.exports = { getRandomProxyAgent, markProxyFailed, markProxySuccess, getProxyStats, _pool: pool }
