const db = require('../src/services/storage/database');
const { redis } = require('../src/middleware/cache');

beforeAll(async () => {
  // Wait for the database connection promise to resolve
  if (db.connectPromise) {
    try {
      await db.connectPromise;
    } catch (err) {
      // Allow test execution when DB is offline
    }
  }
});

afterAll(async () => {
  // Close database to prevent Jest from hanging
  if (db.client) {
    try {
      await db.client.close();
    } catch (err) {}
  }
  // Close Redis connection
  if (redis) {
    try {
      redis.quit();
    } catch (err) {}
  }
});
