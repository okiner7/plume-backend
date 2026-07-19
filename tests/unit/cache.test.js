const { cacheMiddleware } = require('../../src/middleware/cache');

describe('Cache Middleware', () => {
  it('should skip non-GET requests', async () => {
    const req = { method: 'POST' };
    const res = {};
    const next = jest.fn();

    const middleware = cacheMiddleware(10);
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should intercept res.json on GET requests', async () => {
    const req = { method: 'GET', originalUrl: '/test-cache' };
    const next = jest.fn();
    
    let sentBody = null;
    const res = {
      json: jest.fn((body) => {
        sentBody = body;
      })
    };

    const middleware = cacheMiddleware(1);
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();

    // Now call the mocked res.json (which was intercepted by middleware)
    res.json({ success: true, data: 'test' });
    
    expect(sentBody).toEqual({ success: true, data: 'test' });
    
    // Test that the second call returns from cache
    const next2 = jest.fn();
    const res2 = {
      json: jest.fn()
    };
    await middleware(req, res2, next2);
    
    // It should NOT call next if returned from cache
    expect(next2).not.toHaveBeenCalled();
    expect(res2.json).toHaveBeenCalledWith({ success: true, data: 'test' });
  });
});
