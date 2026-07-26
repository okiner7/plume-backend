// Teardown for unit tests: close Redis connection opened by cache.js import
// This prevents "Cannot log after tests are done" warnings
const { redis } = require('../src/middleware/cache')

afterAll(async () => {
  if (redis && typeof redis.quit === 'function') {
    try {
      await redis.quit()
    } catch (_) {}
  }
})
