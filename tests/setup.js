const db = require('../services/storage/database');
const { redis } = require('../src/middleware/cache');

beforeAll(async () => {
  // Wait for the database connection promise to resolve
  if (db.connectPromise) {
    await db.connectPromise;
  }
});

afterAll(async () => {
  // Close database to prevent Jest from hanging
  if (db.client) {
    await db.client.close();
  }
  // Close Redis connection
  if (redis) {
    redis.quit();
  }
});
