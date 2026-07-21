const YTMusic = require('ytmusic-api')
const { getRandomProxyAgent } = require('../../src/middleware/proxyManager')

const ytmusic = new YTMusic()
let initialized = false

async function init() {
  if (!initialized) {
    try {
      await ytmusic.initialize()
      initialized = true
      
      if (ytmusic.client && ytmusic.client.interceptors) {
        ytmusic.client.interceptors.request.use(config => {
          const agent = getRandomProxyAgent()
          if (agent) {
            config.httpsAgent = agent
            config.proxy = false
          }
          return config
        })
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

module.exports = { ytmusic, init, safeArray }
