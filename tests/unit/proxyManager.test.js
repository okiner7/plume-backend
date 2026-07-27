const path = require('path')
const axios = require('axios')
const proxyManager = require('../../src/middleware/proxyManager')

describe('ProxyManager - Background Ping R1 & Smart Selection R2', () => {
  let pool

  beforeEach(() => {
    pool = proxyManager._pool
    // Clean up proxy list for deterministic testing
    pool.stopPingLoop()
    pool._stopRequested = false
    pool.proxies = [
      {
        url: 'http://user:pass@1.1.1.1:8080',
        agent: { host: '1.1.1.1' },
        fails: 0,
        cooldownUntil: 0,
        country: 'US',
        isOffline: false,
        latency: Infinity,
        latencyMap: { soundcloud: Infinity, youtube: Infinity, default: Infinity },
        lastPing: { soundcloud: 0, youtube: 0 }
      },
      {
        url: 'http://user:pass@2.2.2.2:8080',
        agent: { host: '2.2.2.2' },
        fails: 0,
        cooldownUntil: 0,
        country: 'GB',
        isOffline: false,
        latency: Infinity,
        latencyMap: { soundcloud: Infinity, youtube: Infinity, default: Infinity },
        lastPing: { soundcloud: 0, youtube: 0 }
      },
      {
        url: 'http://user:pass@3.3.3.3:8080',
        agent: { host: '3.3.3.3' },
        fails: 0,
        cooldownUntil: 0,
        country: 'DE',
        isOffline: false,
        latency: Infinity,
        latencyMap: { soundcloud: Infinity, youtube: Infinity, default: Infinity },
        lastPing: { soundcloud: 0, youtube: 0 }
      }
    ]
    pool.cursor = 0
  })

  afterEach(() => {
    pool.destroy()
    jest.restoreAllMocks()
  })

  test('R1: _parse initializes latency schema properly', () => {
    const parsed = pool._parse('1.2.3.4:8080:user:pass|US')
    expect(parsed).toBeDefined()
    expect(parsed.latency).toBe(Infinity)
    expect(parsed.latencyMap).toEqual({
      soundcloud: Infinity,
      youtube: Infinity,
      default: Infinity
    })
    expect(parsed.lastPing).toEqual({ soundcloud: 0, youtube: 0 })
    expect(parsed.isOffline).toBe(false)
  })

  test('R1: updateLatency calculates EMA correctly with alpha = 0.7', () => {
    const target = pool.proxies[0]
    
    // First update: from Infinity to 100ms
    pool.updateLatency(target.url, 'soundcloud', 100)
    expect(target.latencyMap.soundcloud).toBe(100)
    expect(target.latencyMap.default).toBe(100)
    expect(target.latency).toBe(100)
    expect(target.lastPing.soundcloud).toBeGreaterThan(0)

    // Second update: EMA with alpha=0.7: 0.7 * 200 + 0.3 * 100 = 140 + 30 = 170
    pool.updateLatency(target.url, 'soundcloud', 200)
    expect(target.latencyMap.soundcloud).toBe(170)
    expect(target.latency).toBe(170)
  })

  test('R2: getCountryAwareAgent handles positional arguments for backward compatibility', () => {
    // Legacy format: 1st argument is Array of forbidden countries
    const res1 = pool.getCountryAwareAgent(['US'])
    expect(res1.country).not.toBe('US')

    // New format: 1st arg service string, 2nd arg forbidden array
    const res2 = pool.getCountryAwareAgent('youtube', ['GB'])
    expect(res2.country).not.toBe('GB')
  })

  test('R2: getCountryAwareAgent sorts by target service latency and applies top-K (50ms window)', () => {
    // Set latencies for soundcloud:
    // Proxy 0 (US): 300ms
    // Proxy 1 (GB): 100ms
    // Proxy 2 (DE): 120ms (within 50ms of fastest 100ms)
    pool.updateLatency(pool.proxies[0].url, 'soundcloud', 300)
    pool.updateLatency(pool.proxies[1].url, 'soundcloud', 100)
    pool.updateLatency(pool.proxies[2].url, 'soundcloud', 120)

    // Top candidates within 50ms of 100ms are Proxy 1 (100ms) and Proxy 2 (120ms).
    // Selection should alternate round-robin between GB and DE, excluding US (300ms).
    const selectedCountries = []
    for (let i = 0; i < 4; i++) {
      const res = pool.getCountryAwareAgent('soundcloud', [])
      selectedCountries.push(res.country)
    }

    expect(selectedCountries).toContain('GB')
    expect(selectedCountries).toContain('DE')
    expect(selectedCountries).not.toContain('US')
  })

  test('R2: getCountryAwareAgent filters offline/cooldown proxies and uses fallback when all on cooldown', () => {
    const now = Date.now()
    pool.proxies[0].isOffline = true
    pool.proxies[1].cooldownUntil = now + 60000 // Cooldown for 60s
    pool.proxies[2].cooldownUntil = now + 120000 // Cooldown for 120s

    // Proxy 1 has earliest cooldown, so fallback should choose Proxy 1 (GB)
    const res = pool.getCountryAwareAgent('soundcloud', [])
    expect(res.agent).toBe(pool.proxies[1].agent)
    expect(res.country).toBe('GB')
  })

  test('getProxyStats reports latency data per proxy', () => {
    pool.updateLatency(pool.proxies[0].url, 'youtube', 150)
    const stats = proxyManager.getProxyStats()
    expect(stats.total).toBe(3)
    expect(stats.proxies[0].latencyMap.youtube).toBe(150)
    expect(stats.proxies[0].latency).toBe(150)
  })

  test('startPingLoop and stopPingLoop execute safely and update abort flags', () => {
    pool.startPingLoop(50000)
    expect(pool._isPinging).toBe(true)
    expect(pool._stopRequested).toBe(false)
    
    pool.stopPingLoop()
    expect(pool._isPinging).toBe(false)
    expect(pool._stopRequested).toBe(true)
  })

  test('_findProxy supports matching by proxy object, agent, full url, masked url, and helper objects', () => {
    const target = pool.proxies[0]

    // Matching wrapper proxy object directly
    expect(pool._findProxy(target)).toBe(target)
    
    // Matching HttpsProxyAgent object
    expect(pool._findProxy(target.agent)).toBe(target)

    // Matching full URL string
    expect(pool._findProxy(target.url)).toBe(target)

    // Matching masked URL string
    expect(pool._findProxy('http://user:***@1.1.1.1:8080')).toBe(target)

    // Matching object with .url or .agent property
    expect(pool._findProxy({ url: target.url })).toBe(target)
    expect(pool._findProxy({ agent: target.agent })).toBe(target)

    // Unmatched input returns null
    expect(pool._findProxy('http://nonexistent:8080')).toBeNull()
    expect(pool._findProxy(null)).toBeNull()

    // updateLatency with proxy object target
    const result = pool.updateLatency(target, 'soundcloud', 85)
    expect(result).toBe(target)
    expect(target.latencyMap.soundcloud).toBe(85)
  })

  test('_pingProxy updates latency from Infinity to numeric value on HTTP 200/204', async () => {
    const target = pool.proxies[0]
    expect(target.latencyMap.soundcloud).toBe(Infinity)

    jest.spyOn(axios, 'head').mockResolvedValue({ status: 200 })
    jest.spyOn(axios, 'get').mockResolvedValue({ status: 204 })

    // SoundCloud ping test
    await pool._pingProxy(target, 'soundcloud')
    expect(target.latencyMap.soundcloud).toBeGreaterThanOrEqual(0)
    expect(target.latencyMap.soundcloud).not.toBe(Infinity)
    expect(target.lastPing.soundcloud).toBeGreaterThan(0)

    // YouTube ping test
    await pool._pingProxy(target, 'youtube')
    expect(target.latencyMap.youtube).toBeGreaterThanOrEqual(0)
    expect(target.latencyMap.youtube).not.toBe(Infinity)
  })

  test('_pingProxy rejects latency updates on HTTP 500 or error status', async () => {
    const target = pool.proxies[0]
    target.latencyMap.soundcloud = Infinity

    jest.spyOn(axios, 'head').mockRejectedValue({ response: { status: 500 } })
    jest.spyOn(axios, 'get').mockResolvedValue({ status: 500 })

    await pool._pingProxy(target, 'soundcloud')
    expect(target.latencyMap.soundcloud).toBe(Infinity)

    await pool._pingProxy(target, 'youtube')
    expect(target.latencyMap.youtube).toBe(Infinity)
  })

  test('_pingProxy aborts update when _stopRequested is true', async () => {
    const target = pool.proxies[0]
    target.latencyMap.soundcloud = Infinity
    pool._stopRequested = true

    jest.spyOn(axios, 'head').mockResolvedValue({ status: 200 })

    await pool._pingProxy(target, 'soundcloud')
    expect(target.latencyMap.soundcloud).toBe(Infinity)
  })

  test('YouTube proxy agent helpers function correctly', () => {
    const agent = proxyManager.getYouTubeProxyAgent()
    expect(agent).toBeDefined()

    const randomYtAgent = proxyManager.getRandomProxyAgent('youtube')
    expect(randomYtAgent).toBeDefined()
  })
})
