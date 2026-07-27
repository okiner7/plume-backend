const YTMusic = require('ytmusic-api')
const proxyManager = require('../../middleware/proxyManager')

const ytmusic = new YTMusic()
let initialized = false

function requestInterceptor(config) {
  const agentData = proxyManager.getCountryAwareProxyAgent('youtube', config._forbiddenCountries || [])
  const agent = agentData?.agent || proxyManager.getRandomProxyAgent('youtube', config._forbiddenCountries || [])
  if (agent) {
    config.httpsAgent = agent
    config.proxy = false
    config._proxyAgent = agent
  }
  return config
}

function responseSuccessInterceptor(res) {
  if (res.config && res.config._proxyAgent) {
    proxyManager.markProxySuccess(res.config._proxyAgent)
  }
  return res
}

function responseErrorInterceptor(err) {
  const status = err.response?.status
  const agent = err.config?._proxyAgent
  if (agent && (status === 403 || status === 429 || !status || status >= 500)) {
    proxyManager.markProxyFailed(agent)
  }
  return Promise.reject(err)
}

async function init() {
  if (!initialized) {
    try {
      await ytmusic.initialize()
      initialized = true
      
      if (ytmusic.client && ytmusic.client.interceptors) {
        ytmusic.client.interceptors.request.use(requestInterceptor)
        ytmusic.client.interceptors.response.use(responseSuccessInterceptor, responseErrorInterceptor)
      }
      if (typeof process.env.NODE_APP_INSTANCE === 'undefined' || process.env.NODE_APP_INSTANCE === '0') {
        const total = process.env.instances || 4
        console.log(`[YouTube] Music client initialized successfully ${total}/${total}`)
      }
    } catch (err) {
      console.error('YT init error:', err.message)
    }
  }
}

function safeArray(v) {
  return Array.isArray(v) ? v : []
}

module.exports = {
  ytmusic,
  init,
  safeArray,
  requestInterceptor,
  responseSuccessInterceptor,
  responseErrorInterceptor
}
