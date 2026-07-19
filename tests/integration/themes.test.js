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

function getValidToken() {
  return jwt.sign({
    provider: 'telegram',
    provider_id: 'theme_user_1',
    name: 'Test User'
  }, process.env.JWT_SECRET);
}

describe('Themes Tests', () => {
  it('should create a theme with valid data', async () => {
    const token = getValidToken();
    const res = await request(app).post('/themes')
      .set(getSignedHeaders('/themes'))
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Theme',
        themeData: { backgroundColor: '#000' }
      });
      
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
  });

  it('should reject invalid themeData', async () => {
    const token = getValidToken();
    const res = await request(app).post('/themes')
      .set(getSignedHeaders('/themes'))
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Theme',
        themeData: 'this is not an object'
      });
      
    expect(res.statusCode).toEqual(500);
    expect(res.body.error).toContain('Valid name and themeData object are required');
  });
});
