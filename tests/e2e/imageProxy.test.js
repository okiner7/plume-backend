/**
 * Dedicated E2E Test Suite for Image Proxy Service (Milestone 3 Verification)
 * Location: lunex-backendv2/tests/e2e/imageProxy.test.js
 *
 * Verifies all Acceptance Criteria (AC1 - AC4) from ORIGINAL_REQUEST.md:
 * - AC1: API responses on /api/yt/* and /api/sc/* return cover URLs wrapped in /api/proxy/image?url=...
 * - AC2: GET /api/proxy/image?url=https://i.ytimg.com/vi/.../hqdefault.jpg returns valid image (HTTP 200) with Cache-Control: public, max-age=604800, immutable
 * - AC3: Duplicate requests for the same cover image return instantly from In-Memory LRU cache (verify X-Cache header and no duplicate upstream fetch)
 * - AC4: Request to /api/proxy/image?url=https://evil.com/test.jpg returns HTTP 400 Bad Request
 */

const request = require('supertest')
const crypto = require('crypto')
const axios = require('axios')
const app = require('../../src/server')
const yt = require('../../src/services/youtube')
const sc = require('../../src/services/soundcloud')
const { imageCache } = require('../../src/routes/proxy.routes')

const APP_SECRET = process.env.APP_SECRET || 'testsecret'

function getSignedHeaders(path) {
  const timestamp = Date.now().toString()
  const signature = crypto.createHmac('sha256', APP_SECRET)
    .update(path + timestamp)
    .digest('hex')
  return {
    'x-plume-timestamp': timestamp,
    'x-plume-signature': signature
  }
}

describe('Image Proxy End-to-End Test Suite (Milestone 3 Verification)', () => {

  beforeEach(() => {
    jest.restoreAllMocks()
    if (imageCache && typeof imageCache.clear === 'function') {
      imageCache.clear()
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  /* =========================================================================
   * AC1: API responses on /api/yt/* and /api/sc/* return wrapped cover URLs
   * ========================================================================= */
  describe('Acceptance Criterion 1 (AC1): API Response Cover URL Rewriting', () => {
    it('should wrap cover URLs in /api/yt/search API responses with /api/proxy/image?url=...', async () => {
      const mockYtResults = {
        tracks: [
          {
            id: 'yt_track_1',
            title: 'Test YouTube Track',
            thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
          }
        ]
      }

      jest.spyOn(yt, 'search').mockResolvedValue(mockYtResults)

      const path = '/api/yt/search?q=testquery_yt'
      const res = await request(app)
        .get(path)
        .set(getSignedHeaders(path))
        .expect(200)

      expect(res.body.success).toBe(true)
      expect(res.body.data.tracks[0].thumbnail).toBe(
        `/api/proxy/image?url=${encodeURIComponent('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')}`
      )
    })

    it('should wrap cover URLs in /api/sc/search API responses with /api/proxy/image?url=...', async () => {
      const mockScResults = {
        collection: [
          {
            id: 998877,
            title: 'Test SoundCloud Track',
            artwork_url: 'https://a1.sndcdn.com/artworks-000123456-large.jpg'
          }
        ]
      }

      jest.spyOn(sc, 'search').mockResolvedValue(mockScResults)

      const path = '/api/sc/search?q=testquery_sc'
      const res = await request(app)
        .get(path)
        .set(getSignedHeaders(path))
        .expect(200)

      expect(res.body.success).toBe(true)
      expect(res.body.data.collection[0].artwork_url).toBe(
        `/api/proxy/image?url=${encodeURIComponent('https://a1.sndcdn.com/artworks-000123456-large.jpg')}`
      )
    })

    it('should recursively rewrite cover URLs inside nested objects and arrays on /api/yt/playlist', async () => {
      const mockPlaylist = {
        id: 'pl_123',
        title: 'Popular Playlist',
        thumbnail: 'https://i.ytimg.com/vi/playlist_thumb/hqdefault.jpg',
        tracks: [
          {
            id: 't1',
            thumbnail: 'https://i.ytimg.com/vi/track1_thumb/hqdefault.jpg',
            artist: {
              avatar: 'https://avatars.yandex.net/get-music-content/99/artist.jpg'
            }
          }
        ]
      }

      jest.spyOn(yt, 'getPlaylist').mockResolvedValue(mockPlaylist)

      const path = '/api/yt/playlist?id=pl_123'
      const res = await request(app)
        .get(path)
        .set(getSignedHeaders(path))
        .expect(200)

      expect(res.body.success).toBe(true)
      expect(res.body.data.thumbnail).toBe(
        `/api/proxy/image?url=${encodeURIComponent('https://i.ytimg.com/vi/playlist_thumb/hqdefault.jpg')}`
      )
      expect(res.body.data.tracks[0].thumbnail).toBe(
        `/api/proxy/image?url=${encodeURIComponent('https://i.ytimg.com/vi/track1_thumb/hqdefault.jpg')}`
      )
      expect(res.body.data.tracks[0].artist.avatar).toBe(
        `/api/proxy/image?url=${encodeURIComponent('https://avatars.yandex.net/get-music-content/99/artist.jpg')}`
      )
    })
  })

  /* =========================================================================
   * AC2: GET /api/proxy/image returns valid image (HTTP 200) with Cache-Control headers
   * ========================================================================= */
  describe('Acceptance Criterion 2 (AC2): GET /api/proxy/image Endpoint & Headers', () => {
    it('should return valid image (HTTP 200) with Cache-Control: public, max-age=604800, immutable', async () => {
      const targetUrl = 'https://i.ytimg.com/vi/ac2_test_video/hqdefault.jpg'
      const mockImageBuffer = Buffer.from('mock-jpeg-binary-image-data-ac2')

      jest.spyOn(axios, 'get').mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
        data: mockImageBuffer
      })

      const res = await request(app)
        .get(`/api/proxy/image?url=${encodeURIComponent(targetUrl)}`)
        .expect(200)

      expect(res.headers['content-type']).toContain('image/jpeg')
      expect(res.headers['cache-control']).toBe('public, max-age=604800, immutable')
      expect(res.headers['x-cache']).toBe('MISS')
      expect(res.body).toEqual(mockImageBuffer)
    })

    it('should support SoundCloud cover proxying (HTTP 200) with correct headers', async () => {
      const targetUrl = 'https://a1.sndcdn.com/artworks-ac2-soundcloud-large.jpg'
      const mockImageBuffer = Buffer.from('mock-png-binary-sc-data')

      jest.spyOn(axios, 'get').mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'image/png' },
        data: mockImageBuffer
      })

      const res = await request(app)
        .get(`/api/proxy/image?url=${encodeURIComponent(targetUrl)}`)
        .expect(200)

      expect(res.headers['content-type']).toContain('image/png')
      expect(res.headers['cache-control']).toBe('public, max-age=604800, immutable')
      expect(res.headers['x-cache']).toBe('MISS')
      expect(res.body).toEqual(mockImageBuffer)
    })

    it('should allow requests to /api/proxy/image without HMAC signature headers (HMAC Bypass)', async () => {
      const targetUrl = 'https://picsum.photos/200/300'
      const mockImageBuffer = Buffer.from('mock-picsum-image')

      jest.spyOn(axios, 'get').mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
        data: mockImageBuffer
      })

      // Send request WITHOUT x-plume-timestamp / x-plume-signature
      const res = await request(app)
        .get(`/api/proxy/image?url=${encodeURIComponent(targetUrl)}`)

      expect(res.status).toBe(200)
      expect(res.headers['cache-control']).toBe('public, max-age=604800, immutable')
    })
  })

  /* =========================================================================
   * AC3: Instant response from In-Memory LRU Cache on duplicate requests
   * ========================================================================= */
  describe('Acceptance Criterion 3 (AC3): In-Memory LRU Cache Verification', () => {
    it('should serve duplicate requests instantly from LRU cache with X-Cache: HIT header and no repeat fetch', async () => {
      const targetUrl = 'https://i.ytimg.com/vi/ac3_lru_test/hqdefault.jpg'
      const mockImageBuffer = Buffer.from('mock-lru-cached-image-bytes')

      const axiosSpy = jest.spyOn(axios, 'get').mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
        data: mockImageBuffer
      })

      // 1st Request: Cache MISS -> upstream fetch
      const res1 = await request(app)
        .get(`/api/proxy/image?url=${encodeURIComponent(targetUrl)}`)
        .expect(200)

      expect(res1.headers['x-cache']).toBe('MISS')
      expect(res1.body).toEqual(mockImageBuffer)
      expect(axiosSpy).toHaveBeenCalledTimes(1)

      // 2nd Request (Duplicate): Cache HIT -> instant response from memory
      const startTime = Date.now()
      const res2 = await request(app)
        .get(`/api/proxy/image?url=${encodeURIComponent(targetUrl)}`)
        .expect(200)
      const duration = Date.now() - startTime

      expect(res2.headers['x-cache']).toBe('HIT')
      expect(res2.headers['cache-control']).toBe('public, max-age=604800, immutable')
      expect(res2.body).toEqual(mockImageBuffer)
      expect(duration).toBeLessThan(100) // Instant delivery (< 100ms)

      // Crucial check: Upstream client (axios.get) must still only have been called ONCE
      expect(axiosSpy).toHaveBeenCalledTimes(1)
    })
  })

  /* =========================================================================
   * AC4: Rejection of non-whitelisted domains & SSRF attack vectors (HTTP 400)
   * ========================================================================= */
  describe('Acceptance Criterion 4 (AC4): SSRF Protection & Domain Whitelist Validation', () => {
    it('should return HTTP 400 Bad Request for non-whitelisted external domain (evil.com)', async () => {
      const res = await request(app)
        .get('/api/proxy/image?url=https://evil.com/test.jpg')
        .expect(400)

      expect(res.body).toEqual({
        success: false,
        error: 'Invalid or forbidden image URL'
      })
    })

    it('should return HTTP 400 Bad Request for local IP / SSRF attack vectors', async () => {
      const vectors = [
        'http://127.0.0.1:8080/admin',
        'http://localhost/secret.png',
        'http://169.254.169.254/latest/meta-data/',
        'http://10.0.0.1/internal'
      ]

      for (const vector of vectors) {
        const res = await request(app)
          .get(`/api/proxy/image?url=${encodeURIComponent(vector)}`)
          .expect(400)

        expect(res.body).toEqual({
          success: false,
          error: 'Invalid or forbidden image URL'
        })
      }
    })

    it('should return HTTP 400 Bad Request for domain spoofing tricks', async () => {
      const spoofedUrls = [
        'https://i.ytimg.com.evil.com/fake.jpg',
        'https://sndcdn.com.attacker.org/phish.png',
        'https://evil-i.ytimg.com/test.jpg'
      ]

      for (const url of spoofedUrls) {
        const res = await request(app)
          .get(`/api/proxy/image?url=${encodeURIComponent(url)}`)
          .expect(400)

        expect(res.body).toEqual({
          success: false,
          error: 'Invalid or forbidden image URL'
        })
      }
    })

    it('should return HTTP 400 Bad Request for non-HTTP protocols (file://, ftp://)', async () => {
      const invalidProtocols = [
        'file:///etc/passwd',
        'ftp://i.ytimg.com/image.jpg',
        'javascript:alert(1)'
      ]

      for (const url of invalidProtocols) {
        const res = await request(app)
          .get(`/api/proxy/image?url=${encodeURIComponent(url)}`)
          .expect(400)

        expect(res.body).toEqual({
          success: false,
          error: 'Invalid or forbidden image URL'
        })
      }
    })

    it('should return HTTP 400 Bad Request when url query parameter is missing', async () => {
      const res = await request(app)
        .get('/api/proxy/image')
        .expect(400)

      expect(res.body).toEqual({
        success: false,
        error: 'Invalid or forbidden image URL'
      })
    })
  })
})
