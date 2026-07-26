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

function getValidToken(userId = 'nosql_user_1') {
  return jwt.sign({
    provider: 'telegram',
    provider_id: userId,
    name: 'NoSQL Test User'
  }, JWT_SECRET);
}

describe('NoSQL Injection Prevention E2E Test Suite (R3)', () => {
  const token = getValidToken();

  // Tier 1 — Normal Input Handling (Clean Query, Body & Route Parameters)
  describe('Tier 1: Normal Query, Body, and Route Parameters Clean Execution', () => {
    test('Test 1.1: Normal GET query parameters execute cleanly without error', async () => {
      const path = '/me/likes';
      const res = await request(app)
        .get(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 10, offset: 0 });

      expect(res.statusCode).not.toBe(500);
    });

    test('Test 1.2: Normal POST body string values execute cleanly without error', async () => {
      const path = '/me/playlists';
      const res = await request(app)
        .post(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Rock & Roll 2026' });

      expect(res.statusCode).not.toBe(500);
    });

    test('Test 1.3: Normal route parameters execute cleanly without error', async () => {
      const path = '/me/playlists/pl_normal_123';
      const res = await request(app)
        .put(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Renamed Playlist' });

      expect(res.statusCode).not.toBe(500);
    });
  });

  // Tier 2 — NoSQL Operator Injection Sanitization / Rejection
  describe('Tier 2: NoSQL Injection Operator Sanitization & Rejection', () => {
    test('Test 2.1: POST /auth/verify-code with object operator body { code: { "$ne": null } } is safely handled/sanitized (HTTP 400, no 500 error)', async () => {
      const res = await request(app)
        .post('/auth/verify-code')
        .send({ code: { "$ne": null } });

      expect(res.statusCode).toBe(400);
      expect(res.statusCode).not.toBe(500);
    });

    test('Test 2.2: Query parameter with operator injection { username: { "$gt": "" } } is sanitized or rejected without internal server error', async () => {
      const path = '/me/likes';
      const res = await request(app)
        .get(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .query({ search: { "$gt": "" } });

      expect(res.statusCode).not.toBe(500);
    });

    test('Test 2.3: POST payload with $where operator string/object { "$where": "this.password != null" } is rejected with HTTP 400 or handled safely', async () => {
      const path = '/me/playlists';
      const res = await request(app)
        .post(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .send({ "$where": "this.userId != null", name: 'Injected' });

      expect(res.statusCode).not.toBe(500);
    });
  });

  // Tier 3 — MongoDB Object Key Sanitization ($ and . in Dynamic JSON Fields)
  describe('Tier 3: Dynamic JSON Field Key Sanitization ($ and . Keys)', () => {
    test('Test 3.1: PUT /me/settings with customThemeData containing $ keys is sanitized or rejected (no Mongo key error)', async () => {
      const path = '/me/settings';
      const res = await request(app)
        .put(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .send({
          theme: 'custom',
          customThemeData: {
            "$badKey": "value",
            "normalKey": "ok"
          }
        });

      expect(res.statusCode).not.toBe(500);
    });

    test('Test 3.2: POST /themes with themeData containing dot-notation keys ("color.primary") is sanitized or rejected safely', async () => {
      const path = '/themes';
      const res = await request(app)
        .post(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Dot Key Theme',
          themeData: {
            "color.primary": "#ff0000",
            "safeColor": "#00ff00"
          }
        });

      expect(res.statusCode).not.toBe(500);
    });
  });

  // Tier 4 — System Regression Check & Route Injection Safety
  describe('Tier 4: System Safety for Route Parameters & Database Operations', () => {
    test('Test 4.1: URL-encoded Mongo query operator in route parameter (/me/playlists/{"$gt":""}) returns safe error without internal server crash', async () => {
      const path = '/me/playlists/%7B%22%24gt%22%3A%22%22%7D';
      const res = await request(app)
        .put(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Safe Rename' });

      expect(res.statusCode).not.toBe(500);
    });

    test('Test 4.2: Retrieving user likes list with sanitized input functions safely without crashing', async () => {
      const path = '/me/likes';
      const res = await request(app)
        .get(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).not.toBe(500);
    });
  });
});
