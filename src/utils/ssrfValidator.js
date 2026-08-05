/**
 * SSRF Validator for Image Proxy Service
 * Validates external image URLs against an allowed domain whitelist.
 */

const ALLOWED_EXACT_HOSTS = new Set([
  'i.ytimg.com',
  'avatars.yandex.net',
  'picsum.photos'
])

/**
 * Validates if the given URL string is an allowed cover image URL.
 * 
 * @param {string} urlString - The URL string to validate.
 * @returns {boolean} True if protocol is HTTP/HTTPS and domain is in whitelist; false otherwise.
 */
function isAllowedImageUrl(urlString) {
  if (!urlString || typeof urlString !== 'string' || !urlString.trim()) {
    return false
  }

  try {
    const parsedUrl = new URL(urlString)

    // Ensure only HTTP and HTTPS protocols are permitted
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return false
    }

    const hostname = parsedUrl.hostname.toLowerCase()

    // Test against allowed hostname patterns
    if (ALLOWED_EXACT_HOSTS.has(hostname)) {
      return true
    }

    // Wildcard match for *.sndcdn.com (e.g. a1.sndcdn.com, i1.sndcdn.com, sndcdn.com)
    if (hostname === 'sndcdn.com' || hostname.endsWith('.sndcdn.com')) {
      return true
    }

    return false
  } catch (err) {
    // Return false for any malformed or unparseable URLs
    return false
  }
}

module.exports = {
  isAllowedImageUrl
}
