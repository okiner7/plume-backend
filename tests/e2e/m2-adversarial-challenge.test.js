const request = require('supertest')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const express = require('express')
const imageProxyMiddleware = require('../../src/middleware/imageProxy')
const { transformImageUrls } = imageProxyMiddleware

const APP_SECRET = process.env.APP_SECRET || 'testsecret'
const JWT_SECRET = process.env.JWT_SECRET || 'testjwt'

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

describe('Milestone 2 Adversarial Stress Test Suite', () => {
  let app

  beforeAll(() => {
    app = require('../../src/server')
  })

  describe('1. transformImageUrls Edge Cases & Deep Hierarchy', () => {
    it('should transform multiple whitelisted domains nested inside complex arrays and objects', () => {
      const complexData = {
        status: 'ok',
        results: [
          {
            id: 'yt1',
            artwork: 'https://i.ytimg.com/vi/test1/hqdefault.jpg',
            author: {
              avatar: 'https://avatars.yandex.net/get-music-content/123/abc.jpg'
            }
          },
          {
            id: 'sc1',
            artwork: 'https://a1.sndcdn.com/artworks-000123-t500x500.jpg',
            related: [
              'https://picsum.photos/id/10/200/300',
              'https://unauthorized-domain.com/image.jpg'
            ]
          }
        ]
      }

      const transformed = transformImageUrls(complexData)

      expect(transformed.results[0].artwork).toBe(
        '/api/proxy/image?url=https%3A%2F%2Fi.ytimg.com%2Fvi%2Ftest1%2Fhqdefault.jpg'
      )
      expect(transformed.results[0].author.avatar).toBe(
        '/api/proxy/image?url=https%3A%2F%2Favatars.yandex.net%2Fget-music-content%2F123%2Fabc.jpg'
      )
      expect(transformed.results[1].artwork).toBe(
        '/api/proxy/image?url=https%3A%2F%2Fa1.sndcdn.com%2Fartworks-000123-t500x500.jpg'
      )
      expect(transformed.results[1].related[0]).toBe(
        '/api/proxy/image?url=https%3A%2F%2Fpicsum.photos%2Fid%2F10%2F200%2F300'
      )
      expect(transformed.results[1].related[1]).toBe('https://unauthorized-domain.com/image.jpg')
    })

    it('should NOT double proxy already proxied URLs', () => {
      const alreadyProxied = '/api/proxy/image?url=https%3A%2F%2Fi.ytimg.com%2Fvi%2Fabc%2Fhqdefault.jpg'
      expect(transformImageUrls(alreadyProxied)).toBe(alreadyProxied)
    })

    it('should leave non-image strings and numbers intact', () => {
      expect(transformImageUrls('hello world')).toBe('hello world')
      expect(transformImageUrls(12345)).toBe(12345)
      expect(transformImageUrls(true)).toBe(true)
      expect(transformImageUrls(null)).toBeNull()
    })
  })

  describe('2. Express Middleware Mount Verification on /api/yt, /api/sc, /me', () => {
    let mockApp

    beforeEach(() => {
      mockApp = express()
      mockApp.use(express.json())

      const ytRouter = express.Router()
      ytRouter.get('/search', (req, res) => {
        res.json({
          success: true,
          data: [
            { id: 'track1', artwork: 'https://i.ytimg.com/vi/search1/hqdefault.jpg' }
          ]
        })
      })

      const scRouter = express.Router()
      scRouter.get('/search', (req, res) => {
        res.json({
          success: true,
          data: [
            { id: 'sc1', artwork: 'https://i1.sndcdn.com/artworks-sc1-t500x500.jpg' }
          ]
        })
      })

      const meRouter = express.Router()
      meRouter.get('/likes', (req, res) => {
        res.json({
          success: true,
          data: [
            { id: 'like1', artwork: 'https://avatars.yandex.net/get-music-content/456/def.jpg' }
          ]
        })
      })

      const indexRoutes = express.Router()
      indexRoutes.use('/api/yt', imageProxyMiddleware, ytRouter)
      indexRoutes.use('/api/sc', imageProxyMiddleware, scRouter)
      indexRoutes.use('/me', imageProxyMiddleware, meRouter)

      mockApp.use(indexRoutes)
    })

    it('should transform /api/yt/search artwork URLs to /api/proxy/image', async () => {
      const res = await request(mockApp).get('/api/yt/search').expect(200)
      expect(res.body.data[0].artwork).toContain('/api/proxy/image?url=')
      expect(res.body.data[0].artwork).toContain(encodeURIComponent('https://i.ytimg.com/vi/search1/hqdefault.jpg'))
    })

    it('should transform /api/sc/search artwork URLs to /api/proxy/image', async () => {
      const res = await request(mockApp).get('/api/sc/search').expect(200)
      expect(res.body.data[0].artwork).toContain('/api/proxy/image?url=')
      expect(res.body.data[0].artwork).toContain(encodeURIComponent('https://i1.sndcdn.com/artworks-sc1-t500x500.jpg'))
    })

    it('should transform /me/likes artwork URLs to /api/proxy/image', async () => {
      const res = await request(mockApp).get('/me/likes').expect(200)
      expect(res.body.data[0].artwork).toContain('/api/proxy/image?url=')
      expect(res.body.data[0].artwork).toContain(encodeURIComponent('https://avatars.yandex.net/get-music-content/456/def.jpg'))
    })
  })

  describe('3. Integration with Full App Router Stack', () => {
    it('should allow /api/proxy/image without signature (HMAC bypass check)', async () => {
      const res = await request(app)
        .get('/api/proxy/image?url=https://i.ytimg.com/vi/test/hqdefault.jpg')
      
      // Should NOT be 403 Forbidden (HMAC bypass works!)
      expect(res.status).not.toBe(403)
    })

    it('should enforce HMAC signature on /api/yt/search when missing', async () => {
      const res = await request(app).get('/api/yt/search?q=test')
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('Access Denied: Missing Signature')
    })
  })
})
