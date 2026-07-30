const { normaliseTrack, shuffleBiased } = require('../../src/services/youtube/search');
const { ytmusic, init, requestInterceptor, responseSuccessInterceptor, responseErrorInterceptor } = require('../../src/services/youtube/client');
const proxyManager = require('../../src/middleware/proxyManager');

describe('YouTube Search Utilities', () => {
  it('should normalise a track object correctly', () => {
    const rawTrack = {
      videoId: 'test_vid_1',
      title: 'Never Gonna Give You Up',
      artists: [{ name: 'Rick Astley', id: 'rick_1' }],
      duration: 213, // seconds
      thumbnails: [{ url: 'small.jpg' }, { url: 'large.jpg' }]
    };

    const formatted = normaliseTrack(rawTrack);
    expect(formatted.id).toBe('test_vid_1');
    expect(formatted.title).toBe('Never Gonna Give You Up');
    expect(formatted.artist).toBe('Rick Astley');
    expect(formatted.duration).toBe(213000); // Should be converted to ms
    expect(formatted.artwork).toBe('large.jpg');
    expect(formatted.url).toBe('https://music.youtube.com/watch?v=test_vid_1');
  });

  it('should normalise a track with missing artist data', () => {
    const rawTrack = {
      videoId: 'test_vid_2',
      name: 'Unknown Track', // YT sometimes returns name instead of title
      author: { name: 'Some Author' }
    };

    const formatted = normaliseTrack(rawTrack);
    expect(formatted.title).toBe('Unknown Track');
    expect(formatted.artist).toBe('Some Author');
    expect(formatted.artwork).toBeNull();
  });

  it('should bias shuffle arrays', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffleBiased(arr);
    
    expect(shuffled.length).toBe(arr.length);
    // Elements should be the same, just order changed
    expect(shuffled).toEqual(expect.arrayContaining(arr));
  });
});

describe('YouTube Client Proxy Integration', () => {
  let mockAgent;

  beforeEach(() => {
    mockAgent = { host: '127.0.0.1', port: 8080 };
    jest.spyOn(proxyManager, 'getCountryAwareProxyAgent').mockReturnValue({ agent: mockAgent, country: 'US' });
    jest.spyOn(proxyManager, 'getRandomProxyAgent').mockReturnValue(mockAgent);
    jest.spyOn(proxyManager, 'markProxySuccess').mockImplementation(() => {});
    jest.spyOn(proxyManager, 'markProxyFailed').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should attach proxy agent on request and report proxy success/fail on response', async () => {
    // 1. Test request interceptor attaches proxy agent
    const dummyConfig = {};
    const updatedConfig = requestInterceptor(dummyConfig);
    expect(updatedConfig.httpsAgent).toBe(mockAgent);
    expect(updatedConfig.proxy).toBe(false);
    expect(updatedConfig._proxyAgent).toBe(mockAgent);

    // 2. Test response success interceptor calls markProxySuccess
    const dummyResponse = { config: { _proxyAgent: mockAgent } };
    responseSuccessInterceptor(dummyResponse);
    expect(proxyManager.markProxySuccess).toHaveBeenCalledWith(mockAgent);

    // 3. Test response error interceptor calls markProxyFailed
    const dummyError = { response: { status: 403 }, config: { _proxyAgent: mockAgent } };
    await expect(responseErrorInterceptor(dummyError)).rejects.toEqual(dummyError);
    expect(proxyManager.markProxyFailed).toHaveBeenCalledWith(mockAgent);
  });
});

describe('lunex-ytdl Utility & Stream Route Integration', () => {
  const lunexYtdl = require('../../src/utils/lunex-ytdl');
  const request = require('supertest');
  const crypto = require('crypto');
  const app = require('../../src/server');

  it('should export getStreamUrl function', () => {
    expect(typeof lunexYtdl.getStreamUrl).toBe('function');
  });

  describe('GET /api/yt/stream', () => {
    const APP_SECRET = process.env.LUNEX_APP_SECRET || 'super-secret-lunex-app-key-2026';

    it('should reject request without auth query params (t, sig)', async () => {
      const res = await request(app).get('/api/yt/stream?id=test_vid');
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('Auth required');
    });

    it('should reject request with invalid signature', async () => {
      const res = await request(app).get('/api/yt/stream?id=test_vid&t=12345&sig=invalid_sig');
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('Invalid signature');
    });

    it('should call getStreamUrl and forward Range headers on valid request', async () => {
      const t = Date.now().toString();
      const sig = crypto.createHmac('sha256', APP_SECRET)
                        .update('/api/yt/stream' + t)
                        .digest('hex');

      jest.spyOn(lunexYtdl, 'getStreamUrl').mockResolvedValue('https://googlevideo.com/videoplayback?id=test_vid');

      const mockData = Buffer.from('test audio data');
      const mockHeaders = new Map([
        ['content-type', 'audio/mp4'],
        ['content-length', mockData.length.toString()],
        ['content-range', `bytes 0-${mockData.length - 1}/${mockData.length}`]
      ]);

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url, options) => {
        if (url.includes('googlevideo.com')) {
          expect(options.headers['Range']).toBe('bytes=0-1023');
          const mockBody = new (require('stream').PassThrough)();
          process.nextTick(() => {
            mockBody.end(mockData);
          });
          return Promise.resolve({
            ok: true,
            status: 206,
            headers: {
              get: (name) => mockHeaders.get(name.toLowerCase()) || null
            },
            body: mockBody
          });
        }
        return originalFetch(url, options);
      });

      try {
        const res = await request(app)
          .get(`/api/yt/stream?id=test_vid&t=${t}&sig=${sig}`)
          .set('Range', 'bytes=0-1023');

        expect(lunexYtdl.getStreamUrl).toHaveBeenCalledWith('test_vid', expect.any(Object));
        expect(res.statusCode).toBe(206);
        expect(res.headers['content-type']).toContain('audio/mp4');
        expect(res.headers['accept-ranges']).toBe('bytes');
        expect(res.headers['content-range']).toBe('bytes 0-14/15');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});

