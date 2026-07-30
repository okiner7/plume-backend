process.env.JWT_SECRET = process.env.JWT_SECRET || 'testjwt'
process.env.DEV_TELEGRAM_IDS = process.env.DEV_TELEGRAM_IDS || '999999'

const request = require('supertest')
const http = require('http')
const app = require('../../src/server')
const jwt = require('jsonwebtoken')
const sseBroadcaster = require('../../src/services/sseBroadcaster')

describe('Admin SSE Integration (Milestone 1)', () => {
  const jwtSecret = process.env.JWT_SECRET
  const adminToken = jwt.sign({ provider: 'telegram', provider_id: '999999' }, jwtSecret)
  const userToken = jwt.sign({ provider: 'telegram', provider_id: '111111' }, jwtSecret)

  describe('1. Authentication & Query Parameter Support', () => {
    it('should reject unauthenticated SSE stream request with 401', async () => {
      const res = await request(app).get('/api/admin/stream')
      expect(res.statusCode).toBe(401)
      expect(res.body.success).toBe(false)
    })

    it('should reject non-admin user SSE stream request with 403', async () => {
      const res = await request(app)
        .get('/api/admin/stream')
        .set('Authorization', `Bearer ${userToken}`)
      expect(res.statusCode).toBe(403)
      expect(res.body.success).toBe(false)
    })

    it('should authenticate SSE stream using req.query.token and return 200 with text/event-stream headers', (done) => {
      const server = app.listen(0, () => {
        const port = server.address().port
        const req = http.get(`http://127.0.0.1:${port}/api/admin/stream?token=${encodeURIComponent(adminToken)}`, (res) => {
          expect(res.statusCode).toBe(200)
          expect(res.headers['content-type']).toContain('text/event-stream')
          expect(res.headers['cache-control']).toContain('no-cache')
          req.destroy()
          server.close(done)
        })
        req.on('error', (err) => {
          server.close(() => done(err))
        })
      })
    })
  })

  describe('2. SSE Event Broadcaster Service Unit Tests', () => {
    it('should format and write heartbeat comment frame : ping\\n\\n', () => {
      let writtenData = ''
      const mockRes = {
        write: (data) => { writtenData += data },
        on: () => {}
      }

      sseBroadcaster.addClient(mockRes)
      sseBroadcaster.sendHeartbeat()
      expect(writtenData).toContain(': ping\n\n')
      sseBroadcaster.removeClient(mockRes)
    })

    it('should broadcast api_hit event to connected clients', () => {
      let writtenData = ''
      const mockRes = {
        write: (data) => { writtenData += data },
        on: () => {}
      }

      sseBroadcaster.addClient(mockRes)
      sseBroadcaster.broadcastApiHit({
        method: 'GET',
        path: '/api/sc/search',
        status: 200,
        duration: 25,
        timestamp: '2026-07-30T20:00:00.000Z'
      })

      expect(writtenData).toContain('event: api_hit')
      expect(writtenData).toContain('/api/sc/search')
      expect(writtenData).toContain('"duration":25')
      sseBroadcaster.removeClient(mockRes)
    })

    it('should broadcast logs event to connected clients', () => {
      let writtenData = ''
      const mockRes = {
        write: (data) => { writtenData += data },
        on: () => {}
      }

      sseBroadcaster.addClient(mockRes)
      sseBroadcaster.broadcastLog('[INFO] System check OK')

      expect(writtenData).toContain('event: logs')
      expect(writtenData).toContain('[INFO] System check OK')
      sseBroadcaster.removeClient(mockRes)
    })
  })
})
