const axios = require('axios')
const { getCountryAwareProxyAgent, markProxyFailed, markProxySuccess } = require('../../src/middleware/proxyManager')

const scClient = axios.create({
  baseURL: 'https://api-v2.soundcloud.com',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://soundcloud.com/',
    'Origin': 'https://soundcloud.com',
    'Accept-Encoding': 'gzip, compress, deflate, br',
    'Connection': 'keep-alive'
  }
})

scClient.interceptors.request.use(config => {
  if (config._forceAgent) {
    config.httpsAgent = config._forceAgent
    config._proxyAgent = config._forceAgent
    config.proxy = false
    return config
  }

  const agentData = getCountryAwareProxyAgent(config._forbiddenCountries || [])
  if (agentData && agentData.agent) {
    config.httpsAgent = agentData.agent
    config._proxyAgent = agentData.agent // сохраняем для markFailed
    config._proxyCountry = agentData.country // для черного списка при 404
    config.proxy = false
  }
  return config
})

// Авто-пометка успешных запросов
scClient.interceptors.response.use(
  res => {
    if (res.config._proxyAgent) markProxySuccess(res.config._proxyAgent)
    return res
  },
  err => {
    const status = err.response?.status
    const agent = err.config?._proxyAgent
    // 403, 429, 0 (timeout/network) — признак проблемного прокси
    if (agent && (status === 403 || status === 429 || !status)) {
      markProxyFailed(agent)
    }
    return Promise.reject(err)
  }
)

let cachedClientId = null
const FALLBACK_CLIENT_ID = 'iErh0hlIS7lC1NEeRzcimBG8NFFF045C'
let refreshPromise = null

async function refreshClientId() {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const { data: html } = await axios.get('https://soundcloud.com', {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
          'Accept-Language': 'ru-RU,ru;q=0.9'
        }
      })

      const scriptUrls = html.match(/https:\/\/a-v2\.sndcdn\.com\/assets\/[a-zA-Z0-9-]+\.js/g)
      if (!scriptUrls) return null

      for (const url of scriptUrls.slice(-15).reverse()) {
        try {
          const { data: js } = await axios.get(url, { timeout: 5000 })
          const match = js.match(/client_id\s*:\s*["']([a-zA-Z0-9]{32})["']/)
          if (match) {
            if (cachedClientId !== match[1]) {
              cachedClientId = match[1]
              console.log('[SoundCloud] Client ID refreshed:', cachedClientId)
            }
            refreshPromise = null
            return cachedClientId
          }
        } catch { continue }
      }
    } catch (e) {
      console.error('[SoundCloud] Scrape Error:', e.message)
    }

    if (!cachedClientId) {
      cachedClientId = FALLBACK_CLIENT_ID
      console.warn('[SoundCloud] Using fallback client_id')
    }
    refreshPromise = null
    return cachedClientId
  })()

  return refreshPromise
}

async function requestFull(pathOrUrl, params = {}, retries = 3, forceAgent = null) {
  if (!cachedClientId) await refreshClientId()

  let lastErr = null
  let forbiddenCountries = []
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    const config = { 
      params: { ...params, client_id: cachedClientId },
      _forbiddenCountries: forbiddenCountries,
      _forceAgent: forceAgent
    }
    
    try {
      const res = await scClient.get(pathOrUrl, config)
      return res
    } catch (err) {
      lastErr = err
      const status = err.response?.status
      
      // 401 Unauthorized — скорее всего протух client_id
      if (status === 401 && attempt < retries) {
        cachedClientId = null
        await refreshClientId()
        continue
      }
      
      // 403, 429 или 0 (timeout) — бан прокси. 
      if ((status === 403 || status === 429 || !status || err.message.includes('captcha')) && attempt < retries) {
        await new Promise(r => setTimeout(r, 500))
        continue
      }

      // 404 — геоблок или удаленный трек
      if (status === 404 && attempt < retries) {
        const failedCountry = err.config?._proxyCountry
        if (failedCountry) {
          forbiddenCountries.push(failedCountry)
          console.warn(`[SoundCloud] 404 on ${pathOrUrl}, blocking country ${failedCountry} for next retry.`)
        } else {
          console.warn(`[SoundCloud] 404 on ${pathOrUrl}, retrying (${attempt}/${retries})...`)
        }
        await new Promise(r => setTimeout(r, 300))
        continue
      }

      break
    }
  }
  
  throw lastErr
}

async function request(pathOrUrl, params = {}, retries = 3, forceAgent = null) {
  const res = await requestFull(pathOrUrl, params, retries, forceAgent)
  return res.data
}

async function fetchAll(initialPath, maxItems = 1000) {
  let results = []
  let nextHref = initialPath
  while (nextHref) {
    const data = await request(nextHref)
    const collection = data.collection || (Array.isArray(data) ? data : (data.tracks ? data.tracks : []))
    results = results.concat(collection)
    nextHref = data.next_href || null
    if (results.length >= maxItems || !collection.length) break
  }
  return results
}

async function getUserId(profileUrl) {
  const user = await request('/resolve', { url: profileUrl })
  if (!user || !user.id) throw new Error('User not found')
  return user.id
}

module.exports = { scClient, request, requestFull, fetchAll, refreshClientId, getUserId }
