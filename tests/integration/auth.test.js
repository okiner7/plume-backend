const request = require('supertest');
const app = require('../../server');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function getSignedHeaders(path) {
  const timestamp = Date.now().toString();
  const signature = crypto.createHmac('sha256', process.env.APP_SECRET)
    .update(path + timestamp)
    .digest('hex');
  return {
    'x-lunex-timestamp': timestamp,
    'x-lunex-signature': signature
  };
}

describe('API Auth & Routing Checks', () => {
  it('should return status OK on root', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toBe('ok');
  });

  it('should block protected routes without token', async () => {
    const res = await request(app).get('/me/likes').set(getSignedHeaders('/me/likes'));
    expect(res.statusCode).toEqual(401);
  });
});

describe('Telegram Auth', () => {
  it('should reject invalid telegram hash', async () => {
    const data = { id: 12345, first_name: 'Hacker', hash: 'fake_hash' };
    const res = await request(app).post('/auth/telegram')
      .set(getSignedHeaders('/auth/telegram'))
      .send(data);
    expect(res.statusCode).toEqual(500); // asyncHandler throws error
    expect(res.body.error).toBe('Invalid Telegram auth data');
  });
});
