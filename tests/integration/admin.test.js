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

describe('Admin API', () => {
  const normalToken = jwt.sign({ provider: 'telegram', provider_id: '111111' }, process.env.JWT_SECRET);
  // Admin token uses the ID defined in DEV_TELEGRAM_IDS (in package.json it's 999999)
  const adminToken = jwt.sign({ provider: 'telegram', provider_id: '999999' }, process.env.JWT_SECRET);

  it('should deny access without a token', async () => {
    const res = await request(app).get('/api/status')
      .set(getSignedHeaders('/api/status'));
    
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should deny access with a normal user token', async () => {
    const res = await request(app).get('/api/status')
      .set(getSignedHeaders('/api/status'))
      .set('Authorization', `Bearer ${normalToken}`);
    
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('should grant access and return stats with an admin token', async () => {
    const res = await request(app).get('/api/status')
      .set(getSignedHeaders('/api/status'))
      .set('Authorization', `Bearer ${adminToken}`);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.memory).toBeDefined();
    expect(res.body.data.proxy).toBeDefined();
  });

  it('should return proxy list for admin', async () => {
    const res = await request(app).get('/api/admin/proxies')
      .set(getSignedHeaders('/api/admin/proxies'))
      .set('Authorization', `Bearer ${adminToken}`);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
