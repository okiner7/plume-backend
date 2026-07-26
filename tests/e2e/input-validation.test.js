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

function getValidToken(userId = 'val_user_1') {
  return jwt.sign({
    provider: 'telegram',
    provider_id: userId,
    name: 'Validation Test User'
  }, JWT_SECRET);
}

describe('Schema Input Validation E2E Test Suite (R2)', () => {
  const token = getValidToken();

  // Tier 1 — Valid Payloads Accepted Across Main Endpoints
  describe('Tier 1: Valid POST and PUT Payloads Acceptance', () => {
    test('Test 1.1: POST /auth/telegram with valid fields is accepted (not 400)', async () => {
      const res = await request(app)
        .post('/auth/telegram')
        .send({
          id: 12345678,
          first_name: 'John',
          last_name: 'Doe',
          username: 'johndoe',
          auth_date: Math.floor(Date.now() / 1000),
          hash: '0000000000000000000000000000000000000000000000000000000000000000'
        });

      expect(res.statusCode).not.toBe(400);
    });

    test('Test 1.2: POST /me/playlists with valid name is accepted (not 400)', async () => {
      const path = '/me/playlists';
      const res = await request(app)
        .post(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'My Favorite Tracks' });

      expect(res.statusCode).not.toBe(400);
    });

    test('Test 1.3: PUT /me/settings with valid settings is accepted (not 400)', async () => {
      const path = '/me/settings';
      const res = await request(app)
        .put(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .send({ theme: 'dark', accent: '#3b82f6' });

      expect(res.statusCode).not.toBe(400);
    });
  });

  // Tier 2 — Unknown & Unexpected Extra Fields Rejection (HTTP 400)
  describe('Tier 2: Unknown & Unexpected Extra Fields Rejection (HTTP 400)', () => {
    test('Test 2.1: POST /auth/telegram with unexpected extra field { isAdmin: true } is rejected with HTTP 400', async () => {
      const res = await request(app)
        .post('/auth/telegram')
        .send({
          id: 12345678,
          first_name: 'John',
          auth_date: Math.floor(Date.now() / 1000),
          hash: 'hash_test',
          isAdmin: true
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.error || res.body.message).toBeDefined();
    });

    test('Test 2.2: POST /me/playlists with unexpected field { unknownField: 123 } is rejected with HTTP 400', async () => {
      const path = '/me/playlists';
      const res = await request(app)
        .post(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Test Playlist', unknownField: 123 });

      expect(res.statusCode).toBe(400);
    });

    test('Test 2.3: PUT /me/settings with prohibited parameter { role: "admin" } is rejected with HTTP 400', async () => {
      const path = '/me/settings';
      const res = await request(app)
        .put(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .send({ theme: 'dark', role: 'admin' });

      expect(res.statusCode).toBe(400);
    });
  });

  // Tier 3 — Missing Required Fields Rejection (HTTP 400)
  describe('Tier 3: Missing Required Fields Rejection (HTTP 400)', () => {
    test('Test 3.1: POST /auth/verify-code missing code is rejected with HTTP 400', async () => {
      const res = await request(app)
        .post('/auth/verify-code')
        .send({});

      expect(res.statusCode).toBe(400);
    });

    test('Test 3.2: POST /me/likes missing trackId is rejected with HTTP 400', async () => {
      const path = '/me/likes';
      const res = await request(app)
        .post(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.statusCode).toBe(400);
    });
  });

  // Tier 4 — Invalid Field Types Rejection (HTTP 400)
  describe('Tier 4: Invalid Field Type Rejection (HTTP 400)', () => {
    test('Test 4.1: POST /me/playlists with numeric name ({ name: 12345 }) is rejected with HTTP 400', async () => {
      const path = '/me/playlists';
      const res = await request(app)
        .post(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 12345 });

      expect(res.statusCode).toBe(400);
    });

    test('Test 4.2: POST /me/likes with object trackId ({ trackId: { id: 1 } }) is rejected with HTTP 400', async () => {
      const path = '/me/likes';
      const res = await request(app)
        .post(path)
        .set(getSignedHeaders(path))
        .set('Authorization', `Bearer ${token}`)
        .send({ trackId: { id: 1 } });

      expect(res.statusCode).toBe(400);
    });
  });
});
