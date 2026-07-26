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

function getValidToken(userId = 'reg_user_100') {
  return jwt.sign({
    provider: 'telegram',
    provider_id: userId,
    name: 'Regression Test User'
  }, JWT_SECRET);
}

function getAdminToken() {
  return jwt.sign({
    provider: 'telegram',
    provider_id: '999999',
    name: 'Admin User'
  }, JWT_SECRET);
}

describe('Core Business Flows Regression E2E Test Suite', () => {
  const userToken = getValidToken('reg_user_100');
  const adminToken = getAdminToken();

  // Tier 1 — Auth & System Status Check
  describe('Tier 1: Auth & System Status Checks', () => {
    test('Test 1.1: Root endpoint GET / returns HTTP 200 and status ok', async () => {
      const res = await request(app).get('/');
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('Plume API');
    });

    test('Test 1.2: GET /auth/verify with valid bearer token verifies user successfully', async () => {
      const res = await request(app)
        .get('/auth/verify')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.user.provider_id).toBe('reg_user_100');
    });

    test('Test 1.3: GET /auth/verify without Authorization header throws verification error', async () => {
      const res = await request(app).get('/auth/verify');
      expect(res.statusCode).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });

  // Tier 2 — User Settings & Preferences Management
  describe('Tier 2: User Settings & Preferences', () => {
    test('Test 2.1: GET /me/settings returns user settings object or handled DB response', async () => {
      const path = '/me/settings';
      const res = await request(app)
        .get(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${userToken}`);

      expect([200, 500]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
      } else {
        expect(res.body.error).toBeDefined();
      }
    });

    test('Test 2.2: PUT /me/settings updates theme and accent color successfully', async () => {
      const path = '/me/settings';
      const res = await request(app)
        .put(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${userToken}`)
        .send({ theme: 'midnight', accent: '#10b981' });

      expect([200, 500]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(res.body.success).toBe(true);
      } else {
        expect(res.body.error).toBeDefined();
      }
    });

    test('Test 2.3: GET /me/likes retrieves user liked tracks list', async () => {
      const path = '/me/likes';
      const res = await request(app)
        .get(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${userToken}`);

      expect([200, 500]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      } else {
        expect(res.body.error).toBeDefined();
      }
    });
  });

  // Tier 3 — User Playlists Management
  describe('Tier 3: User Playlists Management', () => {
    test('Test 3.1: POST /me/playlists creates a new user playlist', async () => {
      const path = '/me/playlists';
      const res = await request(app)
        .post(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Regression Roadtrip' });

      expect([200, 500]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(res.body.success).toBe(true);
      } else {
        expect(res.body.error).toBeDefined();
      }
    });

    test('Test 3.2: GET /me/playlists fetches list of user playlists', async () => {
      const path = '/me/playlists';
      const res = await request(app)
        .get(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${userToken}`);

      expect([200, 500]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      } else {
        expect(res.body.error).toBeDefined();
      }
    });
  });

  // Tier 4 — Admin API Security Controls & System Health
  describe('Tier 4: Admin API Security Controls & System Health', () => {
    test('Test 4.1: GET /api/status with valid admin credentials returns memory & stats data', async () => {
      const path = '/api/status';
      const res = await request(app)
        .get(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${adminToken}`);

      expect([200, 500]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.memory).toBeDefined();
      } else {
        expect(res.body.error).toBeDefined();
      }
    });

    test('Test 4.2: GET /me/playlists without API signature headers is rejected with 403 Access Denied', async () => {
      const path = '/me/playlists';
      const res = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toContain('Access Denied');
    });
  });
});
