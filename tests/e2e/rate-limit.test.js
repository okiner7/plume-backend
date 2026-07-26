const request = require('supertest');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const app = require('../../src/server');

const APP_SECRET = process.env.APP_SECRET || 'testsecret';
const JWT_SECRET = process.env.JWT_SECRET || 'testjwt';

function getSignedHeaders(path) {
  const timestamp = Date.now().toString();
  const signature = crypto.createHmac('sha256', APP_SECRET)
    .update(path + timestamp)
    .digest('hex');
  return {
    'x-plume-timestamp': timestamp,
    'x-plume-signature': signature
  };
}

function getValidToken(userId = 'rate_limit_user') {
  return jwt.sign({
    provider: 'telegram',
    provider_id: userId,
    name: 'Rate Limit User'
  }, JWT_SECRET);
}

function getAdminToken() {
  return jwt.sign({
    provider: 'telegram',
    provider_id: 999999,
    name: 'Admin User'
  }, JWT_SECRET);
}

jest.setTimeout(30000);

describe('Rate Limiting E2E Test Suite (R1)', () => {

  // Tier 1 — Sensitive Auth Endpoints Success Within Limit (1-5 requests)
  describe('Tier 1: Sensitive Auth Endpoints Within Limit (1-5 Requests)', () => {
    test('Test 1.1: /auth/telegram requests 1 through 5 succeed without HTTP 429', async () => {
      const clientIp = '192.168.100.1';
      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .post('/auth/telegram')
          .set('X-Forwarded-For', clientIp)
          .send({ id: 1000 + i, first_name: 'Tester', auth_date: Math.floor(Date.now() / 1000), hash: 'test_hash' });

        expect(res.statusCode).not.toBe(429);
      }
    });

    test('Test 1.2: /auth/verify-code requests 1 through 5 succeed without HTTP 429', async () => {
      const clientIp = '192.168.100.2';
      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .post('/auth/verify-code')
          .set('X-Forwarded-For', clientIp)
          .send({ code: `12340${i}` });

        expect(res.statusCode).not.toBe(429);
      }
    });

    test('Test 1.3: General API endpoint requests 1 through 5 succeed without HTTP 429', async () => {
      const clientIp = '192.168.100.3';
      const path = '/api/status';
      const token = getAdminToken();

      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .get(path)
          .set(getSignedHeaders(path))
          .set('Authorization', `Bearer ${token}`)
          .set('X-Forwarded-For', clientIp);

        expect(res.statusCode).not.toBe(429);
      }
    });
  });

  // Tier 2 — Sensitive & General Endpoint Boundary Limit Enforcement (HTTP 429)
  describe('Tier 2: Rate Limit Boundary Rejection (HTTP 429)', () => {
    test('Test 2.1: /auth/verify-code 6th request within window is rejected with HTTP 429', async () => {
      const clientIp = '192.168.100.10';

      for (let i = 1; i <= 5; i++) {
        await request(app)
          .post('/auth/verify-code')
          .set('X-Forwarded-For', clientIp)
          .send({ code: '654321' });
      }

      const res6 = await request(app)
        .post('/auth/verify-code')
        .set('X-Forwarded-For', clientIp)
        .send({ code: '654321' });

      expect(res6.statusCode).toBe(429);
      expect(res6.body.error || res6.body.message).toBeDefined();
    });

    test('Test 2.2: /auth/telegram 6th request within window is rejected with HTTP 429', async () => {
      const clientIp = '192.168.100.11';

      for (let i = 1; i <= 5; i++) {
        await request(app)
          .post('/auth/telegram')
          .set('X-Forwarded-For', clientIp)
          .send({ id: 999, hash: 'test' });
      }

      const res6 = await request(app)
        .post('/auth/telegram')
        .set('X-Forwarded-For', clientIp)
        .send({ id: 999, hash: 'test' });

      expect(res6.statusCode).toBe(429);
    });

    test('Test 2.3: Non-auth endpoint (/api/status) 101st request per 15 min returns HTTP 429', async () => {
      const clientIp = '192.168.100.12';
      const path = '/api/status';
      const token = getAdminToken();

      for (let i = 1; i <= 100; i++) {
        await request(app)
          .get(path)
          .set(getSignedHeaders(path))
          .set('Authorization', `Bearer ${token}`)
          .set('X-Forwarded-For', clientIp);
      }

      const res101 = await request(app)
        .get(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', clientIp);

      expect(res101.statusCode).toBe(429);
    });
  });

  // Tier 3 — IP Isolation & Cross-Feature Independence
  describe('Tier 3: IP Isolation & Rate Limit Independence', () => {
    test('Test 3.1: Exceeding limit on IP_A does not block requests from distinct IP_B', async () => {
      const ipA = '192.168.100.20';
      const ipB = '192.168.100.21';

      for (let i = 1; i <= 6; i++) {
        await request(app)
          .post('/auth/verify-code')
          .set('X-Forwarded-For', ipA)
          .send({ code: '111111' });
      }

      const resB = await request(app)
        .post('/auth/verify-code')
        .set('X-Forwarded-For', ipB)
        .send({ code: '111111' });

      expect(resB.statusCode).not.toBe(429);
    });

    test('Test 3.2: Exceeding strict auth limit does not corrupt error JSON payload structure', async () => {
      const clientIp = '192.168.100.22';

      for (let i = 1; i <= 5; i++) {
        await request(app)
          .post('/auth/verify-code')
          .set('X-Forwarded-For', clientIp)
          .send({ code: '999999' });
      }

      const res = await request(app)
        .post('/auth/verify-code')
        .set('X-Forwarded-For', clientIp)
        .send({ code: '999999' });

      expect(res.statusCode).toBe(429);
      expect(typeof res.body).toBe('object');
      expect(res.body.success).toBe(false);
    });
  });

  // Tier 4 — Rate Limit Headers Format & Reset Compliance
  describe('Tier 4: Rate Limit Headers Format & Compliance', () => {
    test('Test 4.1: Response headers include RateLimit/X-RateLimit headers', async () => {
      const clientIp = '192.168.100.30';
      const res = await request(app)
        .get('/')
        .set('X-Forwarded-For', clientIp);

      const limitHeader = res.get('RateLimit-Limit') || res.get('x-ratelimit-limit') || res.get('ratelimit-limit');
      const remainingHeader = res.get('RateLimit-Remaining') || res.get('x-ratelimit-remaining') || res.get('ratelimit-remaining');

      expect(limitHeader || remainingHeader).toBeDefined();
    });

    test('Test 4.2: HTTP 429 response contains Retry-After or RateLimit-Reset header', async () => {
      const clientIp = '192.168.100.31';

      for (let i = 1; i <= 6; i++) {
        const res = await request(app)
          .post('/auth/verify-code')
          .set('X-Forwarded-For', clientIp)
          .send({ code: '000000' });

        if (i === 6) {
          expect(res.statusCode).toBe(429);
          const retryAfter = res.get('Retry-After') || res.get('retry-after') || res.get('ratelimit-reset') || res.get('x-ratelimit-reset');
          expect(retryAfter).toBeDefined();
        }
      }
    });
  });
});
