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
    provider_id: 'test_user_1',
    name: 'Test User'
  }, process.env.JWT_SECRET);
}

describe('User Playlists Limits', () => {
  it('should enforce limits on playlists creation', async () => {
    const token = getValidToken();
    let lastRes;
    
    // Create 51 playlists
    for (let i = 0; i < 51; i++) {
      lastRes = await request(app).post('/me/playlists')
        .set(getSignedHeaders('/me/playlists'))
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Playlist ${i}` });
    }
    
    expect(lastRes.statusCode).toEqual(500);
    expect(lastRes.body.error).toContain('limit reached');
  });
});
