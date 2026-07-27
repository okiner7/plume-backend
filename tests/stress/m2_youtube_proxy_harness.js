const path = require('path')
const proxyManager = require('../../src/middleware/proxyManager')
const youtubeClient = require('../../src/services/youtube/client')

const testResults = []

function recordResult(testName, passed, details) {
  testResults.push({ testName, passed, details })
  const statusStr = passed ? '[PASS]' : '[FAIL]'
  console.log(`${statusStr} ${testName}`)
  if (details) {
    console.log(`   Details: ${JSON.stringify(details, null, 2)}`)
  }
}

async function runHarness() {
  console.log('=====================================================')
  console.log('  MILESTONE 2 EMPIRICAL TEST HARNESS: YOUTUBE PROXY')
  console.log('  Failover & Latency Tracking Verification')
  console.log('=====================================================\n')

  const pool = proxyManager._pool

  function setupMockPool() {
    pool.stopPingLoop()
    pool._stopRequested = false
    pool.proxies = [
      {
        url: 'http://user:pass@1.1.1.1:8080',
        agent: { host: '1.1.1.1', id: 'proxy1_us' },
        fails: 0,
        cooldownUntil: 0,
        country: 'US',
        isOffline: false,
        latency: Infinity,
        latencyMap: { soundcloud: 30, youtube: 400, default: 400 },
        lastPing: { soundcloud: Date.now(), youtube: Date.now() }
      },
      {
        url: 'http://user:pass@2.2.2.2:8080',
        agent: { host: '2.2.2.2', id: 'proxy2_gb' },
        fails: 0,
        cooldownUntil: 0,
        country: 'GB',
        isOffline: false,
        latency: Infinity,
        latencyMap: { soundcloud: 300, youtube: 45, default: 45 },
        lastPing: { soundcloud: Date.now(), youtube: Date.now() }
      },
      {
        url: 'http://user:pass@3.3.3.3:8080',
        agent: { host: '3.3.3.3', id: 'proxy3_de' },
        fails: 0,
        cooldownUntil: 0,
        country: 'DE',
        isOffline: false,
        latency: Infinity,
        latencyMap: { soundcloud: 200, youtube: 65, default: 65 },
        lastPing: { soundcloud: Date.now(), youtube: Date.now() }
      }
    ]
    pool.cursor = 0
  }

  // ---------------------------------------------------------------------------
  // TEST GROUP 1: YouTube-Specific Low-Latency Proxy Selection (latencyMap.youtube)
  // ---------------------------------------------------------------------------
  console.log('--- TEST GROUP 1: YouTube Low-Latency Selection (latencyMap.youtube) ---')
  setupMockPool()

  // Test 1.1: YouTube service request uses latencyMap.youtube over soundcloud latency
  let selectedHosts = []
  for (let i = 0; i < 6; i++) {
    const config = { url: 'https://music.youtube.com/api/v1', _forbiddenCountries: [] }
    const intercepted = youtubeClient.requestInterceptor(config)
    if (intercepted.httpsAgent) {
      selectedHosts.push(intercepted.httpsAgent.host)
    }
  }

  const selectsFastestYouTubeProxies = selectedHosts.every(host => host === '2.2.2.2' || host === '3.3.3.3')
  const excludesFastestSoundCloudProxy = !selectedHosts.includes('1.1.1.1')

  recordResult(
    '1.1: YouTube client requestInterceptor selects YouTube low-latency proxies (latencyMap.youtube)',
    selectsFastestYouTubeProxies && excludesFastestSoundCloudProxy,
    {
      selectedHosts,
      proxy1_us_yt_lat: pool.proxies[0].latencyMap.youtube,
      proxy2_gb_yt_lat: pool.proxies[1].latencyMap.youtube,
      proxy3_de_yt_lat: pool.proxies[2].latencyMap.youtube,
      note: 'Proxy 1 (US) has 30ms SoundCloud latency but 400ms YouTube latency. Must be excluded for YouTube.'
    }
  )

  // Test 1.2: Country exclusion with YouTube requestInterceptor
  setupMockPool()
  const configWithForbidden = { url: 'https://music.youtube.com/api/v1', _forbiddenCountries: ['DE'] }
  const interceptedForbidden = youtubeClient.requestInterceptor(configWithForbidden)
  const selectedHostForbidden = interceptedForbidden.httpsAgent ? interceptedForbidden.httpsAgent.host : null

  recordResult(
    '1.2: YouTube requestInterceptor respects forbidden countries (_forbiddenCountries)',
    selectedHostForbidden === '2.2.2.2',
    {
      forbiddenCountries: ['DE'],
      selectedHost: selectedHostForbidden,
      expectedHost: '2.2.2.2 (GB)'
    }
  )

  // ---------------------------------------------------------------------------
  // TEST GROUP 2: HTTP Error Handling & Proxy Cooldown (markProxyFailed)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Error Handling & Proxy Cooldown Failover ---')

  // Test 2.1: HTTP 403 Forbidden triggers markProxyFailed and cooldown after 2 failures
  setupMockPool()
  let targetProxy = pool.proxies[1] // 2.2.2.2
  const error403 = {
    response: { status: 403 },
    config: { _proxyAgent: targetProxy.agent }
  }

  // 1st 403 failure
  try { await youtubeClient.responseErrorInterceptor(error403) } catch (e) {}
  const failsAfter1 = targetProxy.fails

  // 2nd 403 failure
  try { await youtubeClient.responseErrorInterceptor(error403) } catch (e) {}
  const cooldownAfter2 = targetProxy.cooldownUntil > Date.now()

  // Subsequent request should failover away from proxy 2
  const configAfterFail = { url: 'https://music.youtube.com/api/v1' }
  const interceptedAfterFail = youtubeClient.requestInterceptor(configAfterFail)
  const hostAfterFailover = interceptedAfterFail.httpsAgent ? interceptedAfterFail.httpsAgent.host : null

  recordResult(
    '2.1: HTTP 403 triggers markProxyFailed and puts proxy on cooldown after MAX_FAILS (2)',
    failsAfter1 === 1 && cooldownAfter2 && hostAfterFailover !== '2.2.2.2',
    {
      failsAfter1stError: failsAfter1,
      cooldownActiveAfter2ndError: cooldownAfter2,
      failoverHostSelected: hostAfterFailover
    }
  )

  // Test 2.2: HTTP 429 Too Many Requests triggers markProxyFailed and cooldown
  setupMockPool()
  targetProxy = pool.proxies[1]
  const error429 = {
    response: { status: 429 },
    config: { _proxyAgent: targetProxy.agent }
  }

  try { await youtubeClient.responseErrorInterceptor(error429) } catch (e) {}
  try { await youtubeClient.responseErrorInterceptor(error429) } catch (e) {}
  const cooldown429 = targetProxy.cooldownUntil > Date.now()

  recordResult(
    '2.2: HTTP 429 Too Many Requests triggers markProxyFailed and cooldown',
    cooldown429,
    { proxy2_cooldownUntil: targetProxy.cooldownUntil, now: Date.now() }
  )

  // Test 2.3: Network error / Timeout (no status response) triggers markProxyFailed
  setupMockPool()
  targetProxy = pool.proxies[1]
  const networkError = {
    code: 'ECONNRESET',
    message: 'socket hang up',
    config: { _proxyAgent: targetProxy.agent }
  }

  try { await youtubeClient.responseErrorInterceptor(networkError) } catch (e) {}
  try { await youtubeClient.responseErrorInterceptor(networkError) } catch (e) {}
  const cooldownNetwork = targetProxy.cooldownUntil > Date.now()

  recordResult(
    '2.3: Network error / Timeout (no status code) triggers markProxyFailed and cooldown',
    cooldownNetwork,
    { proxy2_cooldownUntil: targetProxy.cooldownUntil }
  )

  // Test 2.4: HTTP 502 Bad Gateway (status >= 500) triggers markProxyFailed
  setupMockPool()
  targetProxy = pool.proxies[1]
  const error502 = {
    response: { status: 502 },
    config: { _proxyAgent: targetProxy.agent }
  }

  try { await youtubeClient.responseErrorInterceptor(error502) } catch (e) {}
  try { await youtubeClient.responseErrorInterceptor(error502) } catch (e) {}
  const cooldown502 = targetProxy.cooldownUntil > Date.now()

  recordResult(
    '2.4: HTTP 5xx Server Error (status >= 500) triggers markProxyFailed and cooldown',
    cooldown502,
    { proxy2_cooldownUntil: targetProxy.cooldownUntil }
  )

  // ---------------------------------------------------------------------------
  // TEST GROUP 3: Response Success Handling & Fallback Behavior
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Success Reset & All-Cooldown Fallback ---')

  // Test 3.1: Response success resets proxy failure count to 0
  setupMockPool()
  targetProxy = pool.proxies[1]
  targetProxy.fails = 1
  const successRes = {
    status: 200,
    config: { _proxyAgent: targetProxy.agent }
  }
  youtubeClient.responseSuccessInterceptor(successRes)

  recordResult(
    '3.1: HTTP 200 responseSuccessInterceptor calls markProxySuccess and resets fails to 0',
    targetProxy.fails === 0,
    { failsCountAfterSuccess: targetProxy.fails }
  )

  // Test 3.2: Fallback when ALL proxies are on cooldown
  setupMockPool()
  const now = Date.now()
  pool.proxies[0].cooldownUntil = now + 600000 // Proxy 1: cooldown in 10 mins
  pool.proxies[1].cooldownUntil = now + 60000  // Proxy 2: cooldown in 1 min (earliest)
  pool.proxies[2].cooldownUntil = now + 300000 // Proxy 3: cooldown in 5 mins

  const fallbackConfig = { url: 'https://music.youtube.com/api/v1' }
  const interceptedFallback = youtubeClient.requestInterceptor(fallbackConfig)
  const selectedFallbackHost = interceptedFallback.httpsAgent ? interceptedFallback.httpsAgent.host : null

  recordResult(
    '3.2: Fallback selection picks proxy with earliest cooldown expiration when all are on cooldown',
    selectedFallbackHost === '2.2.2.2',
    {
      selectedHost: selectedFallbackHost,
      expectedHost: '2.2.2.2 (earliest cooldown expiry: +60s)'
    }
  )

  // ---------------------------------------------------------------------------
  // TEST GROUP 4: Robustness & Non-Blocking Errors
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Edge Cases & Non-Blocking Errors ---')

  // Test 4.1: Non-blocking HTTP 404 (Client Not Found) does NOT trigger markProxyFailed
  setupMockPool()
  targetProxy = pool.proxies[1]
  const error404 = {
    response: { status: 404 },
    config: { _proxyAgent: targetProxy.agent }
  }

  try { await youtubeClient.responseErrorInterceptor(error404) } catch (e) {}
  recordResult(
    '4.1: HTTP 404 Not Found does NOT trigger markProxyFailed (not a proxy block)',
    targetProxy.fails === 0,
    { proxy2_fails: targetProxy.fails }
  )

  // Test 4.2: Handling missing config or missing _proxyAgent in response error interceptor
  setupMockPool()
  let errorHandledWithoutCrash = true
  try {
    await youtubeClient.responseErrorInterceptor({ message: 'Unknown error' })
  } catch (e) {
    if (e.message !== 'Unknown error') {
      errorHandledWithoutCrash = false
    }
  }

  recordResult(
    '4.2: responseErrorInterceptor handles missing config / _proxyAgent gracefully without crashing',
    errorHandledWithoutCrash,
    { errorHandledWithoutCrash }
  )

  // ---------------------------------------------------------------------------
  // SUMMARY AND VERDICT
  // ---------------------------------------------------------------------------
  console.log('\n=====================================================')
  console.log('  SUMMARY OF RESULTS')
  console.log('=====================================================')

  const failedTests = testResults.filter(r => !r.passed)
  const overallPass = failedTests.length === 0

  console.log(`Total Tests Run: ${testResults.length}`)
  console.log(`Passed: ${testResults.length - failedTests.length}`)
  console.log(`Failed: ${failedTests.length}`)
  console.log(`OVERALL VERDICT: ${overallPass ? 'PASS' : 'FAIL'}\n`)

  if (failedTests.length > 0) {
    console.log('Failed Tests List:')
    failedTests.forEach(f => {
      console.log(` - ${f.testName}`)
      console.log(`   Details: ${JSON.stringify(f.details, null, 2)}`)
    })
  }

  return {
    overallPass,
    total: testResults.length,
    passed: testResults.length - failedTests.length,
    failed: failedTests.length,
    results: testResults
  }
}

if (require.main === module) {
  runHarness().then((res) => {
    process.exit(res.overallPass ? 0 : 1)
  }).catch(err => {
    console.error('Harness execution failed:', err)
    process.exit(1)
  })
}

module.exports = { runHarness }
