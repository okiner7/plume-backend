const fs = require('fs')
const path = require('path')
const { HttpsProxyAgent } = require('https-proxy-agent')
const axios = require('axios')

// ─── Proxy Pool Manager ────────────────────────────────────────────────────────
// Поддерживает несколько форматов в proxies.txt:
//   host:port:user:pass   (Webshare / ISP)
//   http://user:pass@host:port
//   http://host:port      (без авторизации)
//   host:port             (без авторизации)
//   В конец можно дописать |US (страна). Если нет, определится автоматически через ip-api.com
// Каждая строка = один прокси. Пустые строки и # игнорируются.
// ─────────────────────────────────────────────────────────────────────────────

const PROXY_FILE = path.join(__dirname, '..', '..', 'proxies.txt')
const MAX_FAILS   = 5      // после 5 ошибок прокси уходит в cooldown
const COOLDOWN_MS = 5 * 60 * 1000  // 5 минут cooldown

class ProxyPool {
  constructor() {
    this.proxies = []      // { url, agent, fails, cooldownUntil, country }
    this.cursor  = 0
    this._load()
    this._watchFile()
  }

  async _resolveCountry(proxy) {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const res = await axios.get('https://ipinfo.io/json', {
        httpsAgent: proxy.agent,
        proxy: false,
        timeout: 5000
      })
      if (res.data && res.data.country) {
        proxy.country = res.data.country
        console.log(`[ProxyPool] Resolved proxy ${proxy.url.replace(/:[^:@]+@/, ':***@')} to ${proxy.country}`)
      }
    } catch (e) {
      console.warn(`[ProxyPool] Failed to resolve country for ${proxy.url.replace(/:[^:@]+@/, ':***@')}: ${e.message}`)
    }
  }

  _parse(line) {
    line = line.trim()
    if (!line || line.startsWith('#')) return null

    let country = null
    if (line.includes('|')) {
      const parts = line.split('|')
      line = parts[0]
      country = parts[1].trim().toUpperCase()
    }

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
      return { url, agent: new HttpsProxyAgent(url), fails: 0, cooldownUntil: 0, country }
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

      parsed.forEach(p => {
        if (!p.country) this._resolveCountry(p)
      })
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

  getAgent() {
    const res = this.getCountryAwareAgent([])
    return res ? res.agent : null
  }

  getCountryAwareAgent(forbiddenCountries = []) {
    if (this.proxies.length === 0) return null

    const now = Date.now()
    let attempts = 0

    while (attempts < this.proxies.length) {
      const idx = this.cursor % this.proxies.length
      this.cursor++
      attempts++

      const proxy = this.proxies[idx]
      if (proxy.cooldownUntil > now) continue
      if (proxy.country && forbiddenCountries.includes(proxy.country)) continue

      return { agent: proxy.agent, country: proxy.country }
    }

    const best = [...this.proxies]
      .filter(p => !p.country || !forbiddenCountries.includes(p.country))
      .sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0] 
      || [...this.proxies].sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0]

    console.warn('[ProxyPool] Using fallback proxy in getCountryAwareAgent')
    return { agent: best?.agent || null, country: best?.country || null }
  }

  // Вызвать когда прокси вернул ошибку 403/429/timeout
  markFailed(agentOrUrl) {
    const proxy = typeof agentOrUrl === 'string' 
      ? this.proxies.find(p => p.url === agentOrUrl)
      : this.proxies.find(p => p.agent === agentOrUrl)
      
    if (!proxy) return
    proxy.fails++
    if (proxy.fails >= MAX_FAILS) {
      proxy.cooldownUntil = Date.now() + COOLDOWN_MS
      proxy.fails = 0
      console.warn(`[ProxyPool] Proxy ${proxy.url.replace(/:[^:@]+@/, ':***@')} → cooldown ${COOLDOWN_MS / 1000}s`)
      
      // Если все прокси легли — немедленно бьем тревогу в ТГ!
      if (this.healthy === 0) {
        try {
          const telegramBot = require('../../services/bot/telegramBot')
          telegramBot.sendAdminAlert(
            `🛑 *СРОЧНО: Все прокси легли!*\nПоследний рабочий прокси только что ушел в cooldown.\n` +
            `Пользователи начнут получать ошибки при попытке включить музыку!`
          )
        } catch (err) {
          console.error('[ProxyPool] Failed to send telegram alert:', err.message)
        }
      }
    }
  }

  // Вызвать при успешном запросе
  markSuccess(agentOrUrl) {
    const proxy = typeof agentOrUrl === 'string' 
      ? this.proxies.find(p => p.url === agentOrUrl)
      : this.proxies.find(p => p.agent === agentOrUrl)
      
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
      country: p.country,
      fails: p.fails,
      status: p.cooldownUntil > now ? `cooldown ${Math.round((p.cooldownUntil - now) / 1000)}s` : 'active'
    }))
  }

  addProxy(url) {
    if (!url.startsWith('http')) {
      const parts = url.split(':')
      if (parts.length === 4) url = `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`
      else if (parts.length === 2) url = `http://${parts[0]}:${parts[1]}`
    }
    
    // Check duplicate
    if (this.proxies.some(p => p.url === url)) return false
    
    const parsed = this._parse(url)
    if (!parsed) throw new Error('Invalid format. Use http://... or ip:port or ip:port:user:pass')
    
    this.proxies.push(parsed)
    if (!parsed.country) this._resolveCountry(parsed)
    
    // Save to file
    this._saveToFile()
    return true
  }

  removeProxy(urlOrMasked) {
    const initialLen = this.proxies.length
    this.proxies = this.proxies.filter(p => p.url !== urlOrMasked && p.url.replace(/:[^:@]+@/, ':***@') !== urlOrMasked)
    if (this.proxies.length < initialLen) {
      this._saveToFile()
      return true
    }
    return false
  }

  _saveToFile() {
    try {
      const content = this.proxies.map(p => p.country ? `${p.url}|${p.country}` : p.url).join('\n')
      // Disable file watcher briefly so it doesn't auto-reload
      fs.writeFileSync(PROXY_FILE, content, 'utf8')
    } catch (e) {
      console.error('[ProxyPool] Failed to save proxies:', e.message)
    }
  }
}

const pool = new ProxyPool()

function getRandomProxyAgent() {
  return pool.getAgent()
}

function getCountryAwareProxyAgent(forbiddenCountries = []) {
  return pool.getCountryAwareAgent(forbiddenCountries)
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

function addProxy(url) {
  return pool.addProxy(url)
}

function removeProxy(url) {
  return pool.removeProxy(url)
}

module.exports = { getRandomProxyAgent, getCountryAwareProxyAgent, markProxyFailed, markProxySuccess, getProxyStats, addProxy, removeProxy, _pool: pool }
