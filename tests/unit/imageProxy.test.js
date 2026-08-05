/**
 * Unit Test Suite for Image Proxy Service (Milestone 1)
 * Location: lunex-backendv2/tests/unit/imageProxy.test.js
 */

const request = require('supertest')
const express = require('express')
const axios = require('axios')
const { isAllowedImageUrl } = require('../../src/utils/ssrfValidator')
const imageProxyMiddleware = require('../../src/middleware/imageProxy')
const { transformImageUrls } = imageProxyMiddleware
const proxyModule = require('../../src/routes/proxy.routes')
const proxyRouter = proxyModule.router || proxyModule
const ImageLruCache = proxyModule.ImageLruCache

describe('Milestone 1: Image Proxy Unit Tests', () => {

  /* =========================================================================
   * 1. SSRF Validator Utility (isAllowedImageUrl)
   * ========================================================================= */
  describe('1. SSRF Validator Utility (isAllowedImageUrl)', () => {
    describe('Valid Whitelisted URLs', () => {
      it('should allow valid YouTube image URLs (i.ytimg.com)', () => {
        expect(isAllowedImageUrl('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')).toBe(true)
        expect(isAllowedImageUrl('http://i.ytimg.com/vi/abc1234/maxresdefault.jpg')).toBe(true)
      })

      it('should allow valid SoundCloud image URLs (*.sndcdn.com)', () => {
        expect(isAllowedImageUrl('https://a1.sndcdn.com/artworks-000123456-large.jpg')).toBe(true)
        expect(isAllowedImageUrl('https://i1.sndcdn.com/avatars-000999999-original.jpg')).toBe(true)
        expect(isAllowedImageUrl('https://sndcdn.com/artworks-sample.jpg')).toBe(true)
      })

      it('should allow valid Yandex Avatar URLs (avatars.yandex.net)', () => {
        expect(isAllowedImageUrl('https://avatars.yandex.net/get-music-content/12345/abcdef.jpg/m1000x1000')).toBe(true)
      })

      it('should allow valid Picsum Photos URLs (picsum.photos)', () => {
        expect(isAllowedImageUrl('https://picsum.photos/200/300')).toBe(true)
        expect(isAllowedImageUrl('https://picsum.photos/id/237/200/300')).toBe(true)
      })
    })

    describe('Invalid & SSRF Attack Vector URLs', () => {
      it('should reject non-whitelisted external domains', () => {
        expect(isAllowedImageUrl('https://evil.com/malicious.jpg')).toBe(false)
        expect(isAllowedImageUrl('https://attacker.org/phishing.png')).toBe(false)
        expect(isAllowedImageUrl('https://google.com')).toBe(false)
        expect(isAllowedImageUrl('https://github.com/avatar.png')).toBe(false)
      })

      it('should reject local / internal IP addresses (SSRF vectors)', () => {
        expect(isAllowedImageUrl('http://localhost/secret')).toBe(false)
        expect(isAllowedImageUrl('http://127.0.0.1/admin')).toBe(false)
        expect(isAllowedImageUrl('http://127.0.0.1:8080/metrics')).toBe(false)
        expect(isAllowedImageUrl('http://[::1]/config')).toBe(false)
        expect(isAllowedImageUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
        expect(isAllowedImageUrl('http://10.0.0.1/internal')).toBe(false)
        expect(isAllowedImageUrl('http://192.168.1.1/router')).toBe(false)
        expect(isAllowedImageUrl('http://0.0.0.0/')).toBe(false)
      })

      it('should reject domain spoofing / suffix tricks', () => {
        expect(isAllowedImageUrl('https://i.ytimg.com.evil.com/fake.jpg')).toBe(false)
        expect(isAllowedImageUrl('https://sndcdn.com.attacker.org/image.png')).toBe(false)
        expect(isAllowedImageUrl('https://avatars.yandex.net.fake.ru/test')).toBe(false)
        expect(isAllowedImageUrl('https://picsum.photos.evil.com/test')).toBe(false)
        expect(isAllowedImageUrl('https://evil-i.ytimg.com/test')).toBe(false)
        expect(isAllowedImageUrl('https://user:pass@i.ytimg.com@evil.com/test')).toBe(false)
      })

      it('should reject non-HTTP/HTTPS protocols', () => {
        expect(isAllowedImageUrl('file:///etc/passwd')).toBe(false)
        expect(isAllowedImageUrl('file:///C:/Windows/system32')).toBe(false)
        expect(isAllowedImageUrl('ftp://i.ytimg.com/file')).toBe(false)
        expect(isAllowedImageUrl('gopher://127.0.0.1:70/')).toBe(false)
        expect(isAllowedImageUrl('javascript:alert(1)')).toBe(false)
        expect(isAllowedImageUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')).toBe(false)
      })

      it('should reject malformed or non-string inputs', () => {
        expect(isAllowedImageUrl(null)).toBe(false)
        expect(isAllowedImageUrl(undefined)).toBe(false)
        expect(isAllowedImageUrl(123)).toBe(false)
        expect(isAllowedImageUrl({})).toBe(false)
        expect(isAllowedImageUrl([])).toBe(false)
        expect(isAllowedImageUrl('')).toBe(false)
        expect(isAllowedImageUrl('   ')).toBe(false)
        expect(isAllowedImageUrl('not-a-valid-url')).toBe(false)
      })
    })
  })

  /* =========================================================================
   * 2. In-Memory LRU Cache Class (ImageLruCache)
   * ========================================================================= */
  describe('2. In-Memory LRU Cache Class (ImageLruCache)', () => {
    let cache

    beforeEach(() => {
      jest.useFakeTimers()
      cache = new ImageLruCache({ maxItems: 3, ttlMs: 1000 })
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should set and get values correctly', () => {
      const buffer = Buffer.from('fake-image-1')
      cache.set('url1', { data: buffer, contentType: 'image/jpeg' })

      const cached = cache.get('url1')
      expect(cached).toBeDefined()
      expect(cached.buffer).toEqual(buffer)
      expect(cached.contentType).toBe('image/jpeg')
    })

    it('should update existing key value and refresh recency on re-set', () => {
      cache.set('url1', { data: Buffer.from('v1'), contentType: 'image/jpeg' })
      cache.set('url1', { data: Buffer.from('v2'), contentType: 'image/png' })

      const cached = cache.get('url1')
      expect(cached.buffer.toString()).toBe('v2')
      expect(cached.contentType).toBe('image/png')
    })

    it('should return null/undefined for non-existent key', () => {
      expect(cache.get('non-existent-url')).toBeFalsy()
    })

    it('should evict the least recently used item when maxItems capacity is exceeded', () => {
      cache.set('url1', { data: Buffer.from('1') })
      cache.set('url2', { data: Buffer.from('2') })
      cache.set('url3', { data: Buffer.from('3') })

      // Access url1 -> recency becomes url2 (oldest), url3, url1 (newest)
      cache.get('url1')

      // Insert url4 -> url2 must be evicted
      cache.set('url4', { data: Buffer.from('4') })

      expect(cache.get('url2')).toBeFalsy() // Evicted
      expect(cache.get('url1')).toBeDefined()
      expect(cache.get('url3')).toBeDefined()
      expect(cache.get('url4')).toBeDefined()
    })

    it('should expire item after TTL passes', () => {
      cache.set('url1', { data: Buffer.from('image-data') })

      // Advance timers by 500ms (< 1000ms TTL)
      jest.advanceTimersByTime(500)
      expect(cache.get('url1')).toBeDefined()

      // Advance timers past TTL (another 600ms -> 1100ms total)
      jest.advanceTimersByTime(600)
      expect(cache.get('url1')).toBeFalsy()
    })

    it('should clear all cache items when clear() is invoked', () => {
      cache.set('url1', { data: Buffer.from('1') })
      cache.set('url2', { data: Buffer.from('2') })

      cache.clear()
      expect(cache.get('url1')).toBeFalsy()
      expect(cache.get('url2')).toBeFalsy()
    })
  })

  /* =========================================================================
   * 3. GET /api/proxy/image Route Handler
   * ========================================================================= */
  describe('3. GET /api/proxy/image Route Handler', () => {
    let app
    let axiosGetSpy

    beforeEach(() => {
      jest.restoreAllMocks()
      axiosGetSpy = jest.spyOn(axios, 'get')
      app = express()
      app.use('/api/proxy', proxyRouter)
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('should return 400 Bad Request when url query parameter is missing', async () => {
      const response = await request(app).get('/api/proxy/image')
      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        success: false,
        error: expect.any(String)
      })
    })

    it('should return 400 Bad Request for forbidden or non-whitelisted domain URL', async () => {
      const response = await request(app).get('/api/proxy/image?url=https://evil.com/hacker.png')
      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        success: false,
        error: 'Invalid or forbidden image URL'
      })
    })

    it('should return 400 Bad Request for SSRF attack vector (localhost / private IP)', async () => {
      const response = await request(app).get('/api/proxy/image?url=http://127.0.0.1:8080/admin')
      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        success: false,
        error: 'Invalid or forbidden image URL'
      })
    })

    it('should proxy valid image stream and set cache headers on cache miss', async () => {
      const targetUrl = 'https://i.ytimg.com/vi/test1234/hqdefault.jpg'
      const mockImageBuffer = Buffer.from('mock-jpeg-binary-stream-data')

      axiosGetSpy.mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
        data: mockImageBuffer
      })

      const response = await request(app)
        .get(`/api/proxy/image?url=${encodeURIComponent(targetUrl)}`)
        .expect(200)

      expect(response.headers['content-type']).toContain('image/jpeg')
      expect(response.headers['cache-control']).toBe('public, max-age=604800, immutable')
      expect(response.body).toEqual(mockImageBuffer)
      expect(axiosGetSpy).toHaveBeenCalledTimes(1)
    })

    it('should return cached image instantly on cache hit without re-fetching upstream', async () => {
      const targetUrl = 'https://a1.sndcdn.com/artworks-000999-large.jpg'
      const mockImageBuffer = Buffer.from('mock-soundcloud-image-data')

      axiosGetSpy.mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'image/png' },
        data: mockImageBuffer
      })

      // First Request -> Cache Miss
      const res1 = await request(app)
        .get(`/api/proxy/image?url=${encodeURIComponent(targetUrl)}`)
        .expect(200)

      expect(res1.headers['content-type']).toContain('image/png')

      // Second Request -> Cache Hit
      const res2 = await request(app)
        .get(`/api/proxy/image?url=${encodeURIComponent(targetUrl)}`)
        .expect(200)

      expect(res2.headers['content-type']).toContain('image/png')
      expect(res2.headers['cache-control']).toBe('public, max-age=604800, immutable')
      expect(res2.body).toEqual(mockImageBuffer)

      // Upstream client (axios.get) must only be called ONCE
      expect(axiosGetSpy).toHaveBeenCalledTimes(1)
    })

    it('should handle upstream HTTP errors gracefully', async () => {
      const targetUrl = 'https://i.ytimg.com/vi/nonexistent/hqdefault.jpg'

      axiosGetSpy.mockRejectedValueOnce({
        response: { status: 404, data: 'Not Found' }
      })

      const response = await request(app)
        .get(`/api/proxy/image?url=${encodeURIComponent(targetUrl)}`)

      expect([400, 404, 502, 500]).toContain(response.status)
    })
  })

  /* =========================================================================
   * 4. Response Transformer Middleware (imageProxyMiddleware - Milestone 2)
   * ========================================================================= */
  describe('4. Response Transformer Middleware (imageProxyMiddleware)', () => {
    describe('transformImageUrls utility function', () => {
      it('should transform YouTube cover image URLs (i.ytimg.com)', () => {
        const ytUrl = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
        expect(transformImageUrls(ytUrl)).toBe(
          `/api/proxy/image?url=${encodeURIComponent(ytUrl)}`
        )
      })

      it('should transform SoundCloud cover image URLs (*.sndcdn.com)', () => {
        const scUrl = 'https://a1.sndcdn.com/artworks-000123456-large.jpg'
        expect(transformImageUrls(scUrl)).toBe(
          `/api/proxy/image?url=${encodeURIComponent(scUrl)}`
        )
      })

      it('should transform Yandex avatar URLs (avatars.yandex.net)', () => {
        const yandexUrl = 'https://avatars.yandex.net/get-music-content/12345/abcdef.jpg/m1000x1000'
        expect(transformImageUrls(yandexUrl)).toBe(
          `/api/proxy/image?url=${encodeURIComponent(yandexUrl)}`
        )
      })

      it('should transform Picsum photos URLs (picsum.photos)', () => {
        const picsumUrl = 'https://picsum.photos/200/300'
        expect(transformImageUrls(picsumUrl)).toBe(
          `/api/proxy/image?url=${encodeURIComponent(picsumUrl)}`
        )
      })

      it('should not transform non-whitelisted image URLs', () => {
        const externalUrl = 'https://evil.com/malicious.png'
        expect(transformImageUrls(externalUrl)).toBe(externalUrl)
      })

      it('should prevent double proxying if URL is already proxied', () => {
        const proxiedUrl = '/api/proxy/image?url=https%3A%2F%2Fi.ytimg.com%2Fvi%2FdQw4w9WgXcQ%2Fhqdefault.jpg'
        expect(transformImageUrls(proxiedUrl)).toBe(proxiedUrl)
      })

      it('should recursively inspect and transform nested objects and arrays in payloads', () => {
        const payload = {
          success: true,
          data: {
            title: 'Track Title',
            cover: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
            variants: [
              'https://a1.sndcdn.com/artworks-000123-large.jpg',
              'https://evil.com/unauthorized.png',
              '/api/proxy/image?url=https%3A%2F%2Fpicsum.photos%2F200'
            ]
          }
        }

        const transformed = transformImageUrls(payload)
        expect(transformed.data.cover).toBe(
          '/api/proxy/image?url=https%3A%2F%2Fi.ytimg.com%2Fvi%2FdQw4w9WgXcQ%2Fhqdefault.jpg'
        )
        expect(transformed.data.variants[0]).toBe(
          '/api/proxy/image?url=https%3A%2F%2Fa1.sndcdn.com%2Fartworks-000123-large.jpg'
        )
        expect(transformed.data.variants[1]).toBe('https://evil.com/unauthorized.png')
        expect(transformed.data.variants[2]).toBe(
          '/api/proxy/image?url=https%3A%2F%2Fpicsum.photos%2F200'
        )
      })

      it('should handle primitives, nulls, and undefined gracefully', () => {
        expect(transformImageUrls(null)).toBeNull()
        expect(transformImageUrls(undefined)).toBeUndefined()
        expect(transformImageUrls(42)).toBe(42)
        expect(transformImageUrls(true)).toBe(true)
      })
    })

    describe('imageProxyMiddleware Express integration', () => {
      let testApp

      beforeEach(() => {
        testApp = express()
        testApp.use(express.json())

        const ytSubRouter = express.Router()
        ytSubRouter.get('/search', (req, res) => {
          res.json({
            results: [
              {
                id: 'yt1',
                thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg'
              }
            ]
          })
        })

        const meSubRouter = express.Router()
        meSubRouter.get('/profile', (req, res) => {
          res.json({
            user: 'testuser',
            avatar: 'https://avatars.yandex.net/get-music-content/1/abc.jpg'
          })
        })

        const mainRouter = express.Router()
        mainRouter.use('/api/yt', imageProxyMiddleware, ytSubRouter)
        mainRouter.use('/me', imageProxyMiddleware, meSubRouter)

        testApp.use(mainRouter)
      })

      it('should rewrite response payload image URLs on /api/yt routes', async () => {
        const res = await request(testApp).get('/api/yt/search').expect(200)
        expect(res.body.results[0].thumbnail).toBe(
          '/api/proxy/image?url=https%3A%2F%2Fi.ytimg.com%2Fvi%2Fabc%2Fhqdefault.jpg'
        )
      })

      it('should rewrite response payload image URLs on /me routes', async () => {
        const res = await request(testApp).get('/me/profile').expect(200)
        expect(res.body.avatar).toBe(
          '/api/proxy/image?url=https%3A%2F%2Favatars.yandex.net%2Fget-music-content%2F1%2Fabc.jpg'
        )
      })
    })
  })
})
