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
const MAX_FAILS   = 2      // Быстро убираем нестабильные прокси
const COOLDOWN_MS = 5 * 60 * 1000  // 5 минут cooldown

class ProxyPool {
  constructor() {
    this.proxies = []      // { url, agent, fails, cooldownUntil, country, isOffline, latency, latencyMap, lastPing }
    this.cursor  = 0
    this.pingInterval = null
    this._isPinging = false
    this._stopRequested = false
    this.watcher = null
    this._load()
    this._watchFile()
    if (process.env.NODE_ENV !== 'test') {
      this.startPingLoop()
    }
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
      return {
        url,
        agent: new HttpsProxyAgent(url, { keepAlive: true }),
        fails: 0,
        cooldownUntil: 0,
        country,
        isOffline: false,
        latency: Infinity,
        latencyMap: { soundcloud: Infinity, youtube: Infinity, default: Infinity },
        lastPing: { soundcloud: 0, youtube: 0 }
      }
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
      if (typeof process.env.NODE_APP_INSTANCE === 'undefined' || process.env.NODE_APP_INSTANCE === '0') {
        console.log(`[ProxyPool] Loaded ${parsed.length} proxies`)
      }

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
        this.watcher = fs.watch(PROXY_FILE, () => {
          console.log('[ProxyPool] proxies.txt changed, reloading...')
          this._load()
        })
      }
    } catch {}
  }

  _findProxy(agentOrUrl) {
    if (!agentOrUrl) return null
    return this.proxies.find(p =>
      p === agentOrUrl ||
      p.agent === agentOrUrl ||
      p.url === agentOrUrl ||
      (typeof agentOrUrl === 'string' && p.url.replace(/:[^:@]+@/, ':***@') === agentOrUrl) ||
      (agentOrUrl && typeof agentOrUrl === 'object' && (p.url === agentOrUrl.url || p.agent === agentOrUrl.agent))
    ) || null
  }

  updateLatency(agentOrUrl, service = 'soundcloud', latencyMs) {
    const proxy = this._findProxy(agentOrUrl)
    if (!proxy) return null

    const s = (service || 'soundcloud').toLowerCase()
    if (!proxy.latencyMap) {
      proxy.latencyMap = { soundcloud: Infinity, youtube: Infinity, default: Infinity }
    }
    if (!proxy.lastPing) {
      proxy.lastPing = { soundcloud: 0, youtube: 0 }
    }

    const alpha = 0.7
    const current = proxy.latencyMap[s]
    let newLatency
    if (current === undefined || current === Infinity || isNaN(current)) {
      newLatency = Math.round(latencyMs)
    } else {
      newLatency = Math.round(alpha * latencyMs + (1 - alpha) * current)
    }

    proxy.latencyMap[s] = newLatency
    proxy.latencyMap.default = newLatency
    proxy.lastPing[s] = Date.now()

    const validLatencies = Object.values(proxy.latencyMap).filter(v => typeof v === 'number' && !isNaN(v) && v !== Infinity)
    proxy.latency = validLatencies.length > 0 ? Math.min(...validLatencies) : Infinity

    if (proxy.isOffline) {
      proxy.isOffline = false
    }

    // console.log(`[ProxyPool] Latency update for ${proxy.url.replace(/:[^:@]+@/, ':***@')} [${s}]: ${newLatency}ms (EMA alpha=0.7)`)
    return proxy
  }

  async _pingProxy(proxy, service) {
    if (this._stopRequested) return
    const start = Date.now()
    let success = false
    let latencyMs = 0

    if (service === 'soundcloud') {
      try {
        const res = await axios.head('https://api-v2.soundcloud.com/', {
          httpsAgent: proxy.agent,
          proxy: false,
          timeout: 3000,
          validateStatus: status => status >= 200 && status < 400
        })
        if (res && res.status >= 200 && res.status < 400) success = true
      } catch {
        try {
          const resFallback = await axios.head('https://soundcloud.com/robots.txt', {
            httpsAgent: proxy.agent,
            proxy: false,
            timeout: 3000,
            validateStatus: status => status >= 200 && status < 400
          })
          if (resFallback && resFallback.status >= 200 && resFallback.status < 400) success = true
        } catch {
          success = false
        }
      }
    } else if (service === 'youtube') {
      try {
        const res = await axios.get('https://music.youtube.com/generate_204', {
          httpsAgent: proxy.agent,
          proxy: false,
          timeout: 3000,
          validateStatus: status => status >= 200 && status < 400
        })
        if (res && res.status >= 200 && res.status < 400) success = true
      } catch {
        success = false
      }
    }

    if (this._stopRequested) return

    latencyMs = Date.now() - start

    if (success) {
      this.updateLatency(proxy, service, latencyMs)
    } else {
      if (!proxy.latencyMap) {
        proxy.latencyMap = { soundcloud: Infinity, youtube: Infinity, default: Infinity }
      }
      proxy.latencyMap[service] = Infinity
      const validLatencies = Object.values(proxy.latencyMap).filter(v => typeof v === 'number' && !isNaN(v) && v !== Infinity)
      proxy.latency = validLatencies.length > 0 ? Math.min(...validLatencies) : Infinity
    }
  }

  async _pingAll() {
    if (this._stopRequested) return
    if (!this.proxies || this.proxies.length === 0) return

    const tasks = []
    for (const proxy of this.proxies) {
      tasks.push(() => this._pingProxy(proxy, 'soundcloud'))
      tasks.push(() => this._pingProxy(proxy, 'youtube'))
    }

    const BATCH_SIZE = 5
    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      if (this._stopRequested) break
      const chunk = tasks.slice(i, i + BATCH_SIZE)
      await Promise.allSettled(chunk.map(fn => fn()))
    }
  }

  startPingLoop(intervalMs = 20000) {
    if (this.pingInterval) return
    this._stopRequested = false
    this._isPinging = true
    this._pingAll().catch(err => console.warn('[ProxyPool] Background ping error:', err.message))
    this.pingInterval = setInterval(() => {
      this._pingAll().catch(err => console.warn('[ProxyPool] Background ping error:', err.message))
    }, intervalMs)
    if (this.pingInterval && typeof this.pingInterval.unref === 'function') {
      this.pingInterval.unref()
    }
    console.log(`[ProxyPool] Background ping loop started (interval: ${intervalMs}ms)`)
  }

  stopPingLoop() {
    this._isPinging = false
    this._stopRequested = true
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
      console.log('[ProxyPool] Background ping loop stopped')
    }
  }

  getAgent(service = 'soundcloud', forbiddenCountries = []) {
    const res = this.getCountryAwareAgent(service, forbiddenCountries)
    return res ? res.agent : null
  }

  destroy() {
    this.stopPingLoop()
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch {}
      this.watcher = null
    }
  }

  close() {
    this.destroy()
  }

  getCountryAwareAgent(arg1 = 'soundcloud', arg2 = [], options = {}) {
    if (this.proxies.length === 0) return null

    let service = 'soundcloud'
    let forbiddenCountries = []

    if (Array.isArray(arg1)) {
      forbiddenCountries = arg1
      if (typeof arg2 === 'string') service = arg2
    } else if (typeof arg1 === 'string') {
      service = arg1
      if (Array.isArray(arg2)) {
        forbiddenCountries = arg2
      } else if (typeof arg2 === 'string') {
        forbiddenCountries = [arg2]
      }
    }

    if (!service || typeof service !== 'string') service = 'soundcloud'
    service = service.toLowerCase()
    if (!['soundcloud', 'youtube'].includes(service)) {
      service = 'soundcloud'
    }

    const normalizedForbidden = (forbiddenCountries || []).map(c => typeof c === 'string' ? c.toUpperCase() : c)
    const now = Date.now()

    // 1. Filter out offline, cooldown, and forbidden countries
    const eligible = this.proxies.filter(p => {
      if (p.isOffline) return false
      if (p.cooldownUntil > now) return false
      if (p.country && normalizedForbidden.includes(p.country.toUpperCase())) return false
      return true
    })

    if (eligible.length > 0) {
      const getLat = (p) => (p.latencyMap && p.latencyMap[service] !== undefined) ? p.latencyMap[service] : (p.latency ?? Infinity)

      // Sort eligible candidate proxies ascending by target service latency
      eligible.sort((a, b) => getLat(a) - getLat(b))

      const minLatency = getLat(eligible[0])

      // Top 3 lowest latency proxies within 50ms of the fastest candidate
      const top3 = eligible.slice(0, 3)
      const topCandidates = top3.filter(p => {
        const lat = getLat(p)
        if (minLatency === Infinity) return true
        return lat <= minLatency + 50
      })

      const selected = topCandidates[this.cursor % topCandidates.length]
      this.cursor++

      const selectedLat = getLat(selected)
      console.log(`[ProxyPool] Selected fast proxy ${selected.url.replace(/:[^:@]+@/, ':***@')} (${selected.country || 'unknown'}) for ${service} (latency: ${selectedLat === Infinity ? 'inf' : selectedLat + 'ms'})`)

      return { agent: selected.agent, country: selected.country }
    }

    // Fallback if all proxies are currently on cooldown
    console.warn('[ProxyPool] Using fallback proxy in getCountryAwareAgent')
    const best = [...this.proxies]
      .filter(p => !p.isOffline)
      .filter(p => !p.country || !normalizedForbidden.includes(p.country.toUpperCase()))
      .sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0]
      || [...this.proxies].filter(p => !p.isOffline).sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0]

    return { agent: best?.agent || null, country: best?.country || null }
  }

  // Вызвать когда прокси вернул ошибку 403/429/timeout
  markFailed(agentOrUrl) {
    const proxy = this._findProxy(agentOrUrl)
      
    if (!proxy) return
    proxy.fails++
    if (proxy.fails >= MAX_FAILS) {
      proxy.cooldownUntil = Date.now() + COOLDOWN_MS
      proxy.fails = 0
      console.warn(`[ProxyPool] Proxy ${proxy.url.replace(/:[^:@]+@/, ':***@')} → cooldown ${COOLDOWN_MS / 1000}s`)
      
      // Если все прокси легли — немедленно бьем тревогу в ТГ!
      if (this.healthy === 0) {
        try {
          const telegramBot = require('../services/bot/telegramBot')
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

  markOffline(agentOrUrl) {
    const proxy = this._findProxy(agentOrUrl)
      
    if (proxy && !proxy.isOffline) {
      proxy.isOffline = true
      console.warn(`[ProxyPool] Proxy ${proxy.url.replace(/:[^:@]+@/, ':***@')} → OFFLINE`)
    }
  }

  markOnline(agentOrUrl) {
    const proxy = this._findProxy(agentOrUrl)
      
    if (proxy) proxy.isOffline = false
  }

  // Вызвать при успешном запросе
  markSuccess(agentOrUrl) {
    const proxy = this._findProxy(agentOrUrl)
      
    if (proxy) {
      proxy.fails = 0
      proxy.isOffline = false
    }
  }

  get count()    { return this.proxies.length }
  get healthy()  { return this.proxies.filter(p => !p.isOffline && p.cooldownUntil < Date.now()).length }

  getStats() {
    const now = Date.now()
    return this.proxies.map((p, i) => ({
      index: i,
      url: p.url.replace(/:[^:@]+@/, ':***@'),
      _url: p.url, // реальный URL для health checker
      country: p.country,
      fails: p.fails,
      status: p.isOffline ? 'offline' : (p.cooldownUntil > now ? `cooldown ${Math.round((p.cooldownUntil - now) / 1000)}s` : 'active'),
      latency: p.latency ?? Infinity,
      latencyMap: p.latencyMap ? { ...p.latencyMap } : { soundcloud: Infinity, youtube: Infinity, default: Infinity },
      lastPing: p.lastPing ? { ...p.lastPing } : { soundcloud: 0, youtube: 0 }
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

function getRandomProxyAgent(service = 'soundcloud', forbiddenCountries = []) {
  return pool.getAgent(service, forbiddenCountries)
}

function getCountryAwareProxyAgent(arg1 = 'soundcloud', arg2 = []) {
  return pool.getCountryAwareAgent(arg1, arg2)
}

function getYouTubeProxyAgent(forbiddenCountries = []) {
  return pool.getAgent('youtube', forbiddenCountries)
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

function updateLatency(agentOrUrl, service, latencyMs) {
  return pool.updateLatency(agentOrUrl, service, latencyMs)
}

function startPingLoop(intervalMs) {
  return pool.startPingLoop(intervalMs)
}

function stopPingLoop() {
  return pool.stopPingLoop()
}

function destroy() {
  return pool.destroy()
}

function close() {
  return pool.close()
}

module.exports = {
  getRandomProxyAgent,
  getCountryAwareProxyAgent,
  getYouTubeProxyAgent,
  markProxyFailed,
  markProxySuccess,
  getProxyStats,
  addProxy,
  removeProxy,
  updateLatency,
  startPingLoop,
  stopPingLoop,
  destroy,
  close,
  _pool: pool
}
