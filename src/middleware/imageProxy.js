const { isAllowedImageUrl } = require('../utils/ssrfValidator')

/**
 * Recursively iterates through a data payload (objects, arrays, strings)
 * and transforms whitelisted cover image URLs to the image proxy format.
 *
 * @param {*} data - The payload or nested value to transform.
 * @returns {*} The transformed payload.
 */
function transformImageUrls(data) {
  if (typeof data === 'string') {
    // Prevent double proxying if the URL is already proxied
    if (data.includes('/api/proxy/image?url=')) {
      return data
    }

    if (isAllowedImageUrl(data)) {
      return `/api/proxy/image?url=${encodeURIComponent(data)}`
    }

    return data
  }

  if (Array.isArray(data)) {
    return data.map(item => transformImageUrls(item))
  }

  if (data !== null && typeof data === 'object') {
    if (Buffer.isBuffer(data) || data instanceof Date) {
      return data
    }

    const transformed = {}
    for (const key of Object.keys(data)) {
      transformed[key] = transformImageUrls(data[key])
    }
    return transformed
  }

  return data
}

/**
 * Express middleware that intercepts res.json to automatically transform
 * external image URLs in API responses into proxied URLs.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function imageProxyMiddleware(req, res, next) {
  const originalJson = res.json

  res.json = function (body) {
    if (body !== undefined && body !== null) {
      body = transformImageUrls(body)
    }
    return originalJson.call(this, body)
  }

  next()
}

imageProxyMiddleware.imageProxyMiddleware = imageProxyMiddleware
imageProxyMiddleware.transformImageUrls = transformImageUrls

module.exports = imageProxyMiddleware
