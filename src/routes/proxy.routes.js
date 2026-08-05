const { Router } = require('express')
const axios = require('axios')
const { isAllowedImageUrl } = require('../utils/ssrfValidator')
const proxyManager = require('../middleware/proxyManager')

// ─── Image LRU Cache Class ───────────────────────────────────────────────────
class ImageLruCache {
  /**
   * @param {Object} options
   * @param {number} options.maxByteSize - Maximum total memory in bytes (default: 50MB)
   * @param {number} options.maxItems - Maximum number of items in cache (default: 1000)
   * @param {number} options.ttlMs - Time to live in milliseconds (default: 7 days)
   */
  constructor(options = {}) {
    this.maxByteSize = options.maxByteSize || 50 * 1024 * 1024 // 50MB
    this.maxItems = options.maxItems || 1000
    this.ttlMs = options.ttlMs || 604800 * 1000 // 7 days in ms
    this.map = new Map()
    this.currentByteSize = 0
  }

  /**
   * Retrieve cached buffer and content-type if valid and non-expired.
   * @param {string} key
   * @returns {{ buffer: Buffer, data: Buffer, contentType: string } | null}
   */
  get(key) {
    if (!this.map.has(key)) return null

    const entry = this.map.get(key)

    // Passive TTL expiration check
    if (Date.now() > entry.expiresAt) {
      this.delete(key)
      return null
    }

    // Refresh position for LRU (re-insert key to move to the end of Map)
    this.map.delete(key)
    this.map.set(key, entry)

    return {
      buffer: entry.buffer,
      data: entry.buffer,
      contentType: entry.contentType
    }
  }

  /**
   * Store image buffer in LRU cache with eviction if limits are exceeded.
   * Accepts set(key, buffer, contentType) OR set(key, { data: buffer, contentType }).
   * @param {string} key
   * @param {Buffer|Object} value
   * @param {string} contentType
   */
  set(key, value, contentType) {
    let buf, ct
    if (Buffer.isBuffer(value)) {
      buf = value
      ct = contentType || 'image/jpeg'
    } else if (value && typeof value === 'object') {
      buf = value.buffer || value.data
      ct = value.contentType || contentType || 'image/jpeg'
    }

    if (!Buffer.isBuffer(buf)) return

    const itemSize = buf.length

    // Skip caching if single item exceeds total cache limit
    if (itemSize > this.maxByteSize) return

    // If key already exists, remove existing item to adjust byte size
    if (this.map.has(key)) {
      this.delete(key)
    }

    // Evict least recently used (first key in Map) while exceeding capacity
    while (
      (this.currentByteSize + itemSize > this.maxByteSize || this.map.size >= this.maxItems) &&
      this.map.size > 0
    ) {
      const oldestKey = this.map.keys().next().value
      this.delete(oldestKey)
    }

    const entry = {
      buffer: buf,
      contentType: ct,
      size: itemSize,
      expiresAt: Date.now() + this.ttlMs,
      createdAt: Date.now()
    }

    this.map.set(key, entry)
    this.currentByteSize += itemSize
  }

  /**
   * Remove entry by key and update total byte size.
   * @param {string} key
   */
  delete(key) {
    if (this.map.has(key)) {
      const entry = this.map.get(key)
      this.currentByteSize -= entry.size || 0
      if (this.currentByteSize < 0) this.currentByteSize = 0
      this.map.delete(key)
    }
  }

  /**
   * Clear all cached entries.
   */
  clear() {
    this.map.clear()
    this.currentByteSize = 0
  }

  /**
   * Cache statistics helper for diagnostics and testing.
   */
  getStats() {
    return {
      itemCount: this.map.size,
      currentByteSize: this.currentByteSize,
      maxByteSize: this.maxByteSize,
      maxItems: this.maxItems
    }
  }
}

// Singleton cache instance
const imageCache = new ImageLruCache()

// ─── Express Router ─────────────────────────────────────────────────────────
const router = Router()

/**
 * GET /api/proxy/image?url=<target_url>
 * Serves cached or upstream-proxied image with Cache-Control headers.
 */
router.get('/image', async (req, res, next) => {
  try {
    const { url } = req.query

    // 1. SSRF Validation
    if (!url || typeof url !== 'string' || !url.trim() || !isAllowedImageUrl(url)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or forbidden image URL'
      })
    }

    // 2. LRU Cache Lookup
    const cached = imageCache.get(url)
    if (cached) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
      res.setHeader('Content-Type', cached.contentType)
      res.setHeader('Content-Length', cached.buffer.length)
      res.setHeader('X-Cache', 'HIT')
      return res.send(cached.buffer)
    }

    // 3. Upstream Fetch (Direct -> Proxy Fallback)
    let buffer = null
    let contentType = 'image/jpeg'
    let fetchSuccess = false

    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    }

    // Attempt 1: Direct fetch
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 5000,
        headers: requestHeaders
      })

      if (response.status === 200 && response.data) {
        buffer = Buffer.from(response.data)
        contentType = response.headers['content-type'] || 'image/jpeg'
        fetchSuccess = true
      }
    } catch (directErr) {
      // Direct fetch failed, fallback to proxy pool
    }

    // Attempt 2: Proxy pool fallback if direct fetch failed
    if (!fetchSuccess) {
      const service = url.includes('ytimg.com') ? 'youtube' : 'soundcloud'
      const proxyObj = typeof proxyManager.getCountryAwareProxyAgent === 'function'
        ? proxyManager.getCountryAwareProxyAgent(service)
        : null

      if (proxyObj && proxyObj.agent) {
        try {
          const response = await axios.get(url, {
            httpsAgent: proxyObj.agent,
            proxy: false,
            responseType: 'arraybuffer',
            timeout: 8000,
            headers: requestHeaders
          })

          if (response.status === 200 && response.data) {
            buffer = Buffer.from(response.data)
            contentType = response.headers['content-type'] || 'image/jpeg'
            fetchSuccess = true
            if (typeof proxyManager.markProxySuccess === 'function') {
              proxyManager.markProxySuccess(proxyObj.agent || proxyObj.url)
            }
          }
        } catch (proxyErr) {
          if (typeof proxyManager.markProxyFailed === 'function') {
            proxyManager.markProxyFailed(proxyObj.agent || proxyObj.url)
          }
        }
      }
    }

    // 4. Rejection on failure
    if (!fetchSuccess || !buffer) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or forbidden image URL'
      })
    }

    // 5. Store in LRU Cache
    imageCache.set(url, buffer, contentType)

    // 6. Return Response
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', buffer.length)
    res.setHeader('X-Cache', 'MISS')
    return res.send(buffer)
  } catch (err) {
    next(err)
  }
})

module.exports = router
module.exports.router = router
module.exports.ImageLruCache = ImageLruCache
module.exports.imageCache = imageCache
