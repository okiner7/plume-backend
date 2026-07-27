/**
 * Empirical Verification Harness for Challenger 3 (Milestone 2 Re-Verification)
 * Topic: Proxy Latency Mutation & Status Validation
 */

const axios = require('axios')
const proxyManager = require('../src/middleware/proxyManager')

async function runEmpiricalHarness() {
  console.log('====================================================')
  console.log(' EMPIRICAL VERIFICATION HARNESS - CHALLENGER 3 (M2)')
  console.log('====================================================\n')

  let totalTests = 0
  let passedTests = 0
  const results = []

  function assert(description, condition, details = '') {
    totalTests++
    if (condition) {
      passedTests++
      console.log(`[PASS] Test ${totalTests}: ${description}`)
      results.push({ test: totalTests, description, status: 'PASS', details })
    } else {
      console.error(`[FAIL] Test ${totalTests}: ${description}`)
      if (details) console.error(`       Details: ${details}`)
      results.push({ test: totalTests, description, status: 'FAIL', details })
    }
  }

  const pool = proxyManager._pool

  // Helper setup: Reset pool state with known proxies
  function resetPool() {
    pool.stopPingLoop()
    pool._stopRequested = false
    pool.proxies = [
      {
        url: 'http://user1:pass1@1.1.1.1:8080',
        agent: { host: '1.1.1.1', port: 8080 },
        fails: 0,
        cooldownUntil: 0,
        country: 'US',
        isOffline: false,
        latency: Infinity,
        latencyMap: { soundcloud: Infinity, youtube: Infinity, default: Infinity },
        lastPing: { soundcloud: 0, youtube: 0 }
      },
      {
        url: 'http://user2:pass2@2.2.2.2:8080',
        agent: { host: '2.2.2.2', port: 8080 },
        fails: 0,
        cooldownUntil: 0,
        country: 'GB',
        isOffline: false,
        latency: Infinity,
        latencyMap: { soundcloud: Infinity, youtube: Infinity, default: Infinity },
        lastPing: { soundcloud: 0, youtube: 0 }
      }
    ]
    pool.cursor = 0
  }

  // ---------------------------------------------------------------------------
  // REQUIREMENT 1: _findProxy matching across proxy wrapper objects, agent instances, URL strings, masked URLs, and helper objects
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 1: _findProxy Matching Verification ---')
  resetPool()
  const p1 = pool.proxies[0]
  const p2 = pool.proxies[1]

  // 1.1 Match by proxy wrapper object directly
  const match1 = pool._findProxy(p1)
  assert('_findProxy matches proxy wrapper object directly', match1 === p1, `Expected ${p1.url}, got ${match1 ? match1.url : null}`)

  // 1.2 Match by agent instance
  const match2 = pool._findProxy(p1.agent)
  assert('_findProxy matches agent instance', match2 === p1, `Expected ${p1.url}, got ${match2 ? match2.url : null}`)

  // 1.3 Match by full URL string
  const match3 = pool._findProxy('http://user1:pass1@1.1.1.1:8080')
  assert('_findProxy matches full URL string', match3 === p1, `Expected ${p1.url}, got ${match3 ? match3.url : null}`)

  // 1.4 Match by masked URL string
  const match4 = pool._findProxy('http://user1:***@1.1.1.1:8080')
  assert('_findProxy matches masked URL string', match4 === p1, `Expected ${p1.url}, got ${match4 ? match4.url : null}`)

  // 1.5 Match by wrapper object containing .url
  const match5 = pool._findProxy({ url: 'http://user2:pass2@2.2.2.2:8080' })
  assert('_findProxy matches wrapper object with .url', match5 === p2, `Expected ${p2.url}, got ${match5 ? match5.url : null}`)

  // 1.6 Match by wrapper object containing .agent
  const match6 = pool._findProxy({ agent: p2.agent })
  assert('_findProxy matches wrapper object with .agent', match6 === p2, `Expected ${p2.url}, got ${match6 ? match6.url : null}`)

  // 1.7 Non-matching inputs return null
  const match7 = pool._findProxy('http://99.99.99.99:8080')
  assert('_findProxy returns null for non-existent proxy', match7 === null, `Expected null, got ${match7}`)

  // 1.8 updateLatency accepts all valid matching formats
  const updated1 = pool.updateLatency(p1.agent, 'soundcloud', 120)
  assert('updateLatency resolves target via agent instance and updates latency', updated1 && p1.latencyMap.soundcloud === 120, `Latency: ${p1.latencyMap.soundcloud}`)

  const updated2 = pool.updateLatency('http://user1:***@1.1.1.1:8080', 'youtube', 90)
  assert('updateLatency resolves target via masked URL string and updates latency', updated2 && p1.latencyMap.youtube === 90, `Latency: ${p1.latencyMap.youtube}`)


  // ---------------------------------------------------------------------------
  // REQUIREMENT 2: Background ping execution mutating proxy.latencyMap from Infinity to numeric milliseconds
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 2: Background Ping Latency Mutation ---')
  resetPool()
  const targetProxy = pool.proxies[0]

  assert('Initial proxy SoundCloud latency is Infinity', targetProxy.latencyMap.soundcloud === Infinity)
  assert('Initial proxy YouTube latency is Infinity', targetProxy.latencyMap.youtube === Infinity)
  assert('Initial overall latency is Infinity', targetProxy.latency === Infinity)

  // Mock axios HTTP success (200 for soundcloud, 204 for youtube)
  const originalHead = axios.head
  const originalGet = axios.get

  axios.head = async () => ({ status: 200, data: 'OK' })
  axios.get = async () => ({ status: 204, data: '' })

  try {
    await pool._pingProxy(targetProxy, 'soundcloud')
    assert(
      'SoundCloud ping mutates latencyMap.soundcloud from Infinity to numeric ms',
      typeof targetProxy.latencyMap.soundcloud === 'number' &&
      !isNaN(targetProxy.latencyMap.soundcloud) &&
      targetProxy.latencyMap.soundcloud !== Infinity &&
      targetProxy.latencyMap.soundcloud >= 0,
      `Value: ${targetProxy.latencyMap.soundcloud}ms`
    )

    await pool._pingProxy(targetProxy, 'youtube')
    assert(
      'YouTube ping mutates latencyMap.youtube from Infinity to numeric ms',
      typeof targetProxy.latencyMap.youtube === 'number' &&
      !isNaN(targetProxy.latencyMap.youtube) &&
      targetProxy.latencyMap.youtube !== Infinity &&
      targetProxy.latencyMap.youtube >= 0,
      `Value: ${targetProxy.latencyMap.youtube}ms`
    )

    assert(
      'Overall proxy.latency updated to minimum valid service latency',
      targetProxy.latency === Math.min(targetProxy.latencyMap.soundcloud, targetProxy.latencyMap.youtube),
      `Overall latency: ${targetProxy.latency}ms`
    )

    assert(
      'proxy.lastPing timestamp recorded for both services',
      targetProxy.lastPing.soundcloud > 0 && targetProxy.lastPing.youtube > 0,
      `lastPing: ${JSON.stringify(targetProxy.lastPing)}`
    )

    // Test _pingAll batch execution
    resetPool()
    axios.head = async () => ({ status: 200 })
    axios.get = async () => ({ status: 204 })
    await pool._pingAll()

    const allMutated = pool.proxies.every(p =>
      typeof p.latencyMap.soundcloud === 'number' && p.latencyMap.soundcloud !== Infinity &&
      typeof p.latencyMap.youtube === 'number' && p.latencyMap.youtube !== Infinity
    )
    assert('_pingAll mutates latencyMap for all proxies in pool', allMutated)
  } finally {
    axios.head = originalHead
    axios.get = originalGet
  }


  // ---------------------------------------------------------------------------
  // REQUIREMENT 3: HTTP status 500, 502, 403, 429 ping responses rejected (leaving latency at Infinity)
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 3: HTTP Error Status Rejection (500, 502, 403, 429) ---')
  
  const statusCodes = [500, 502, 403, 429]

  for (const status of statusCodes) {
    resetPool()
    const testP = pool.proxies[0]

    // Simulate axios behavior when validateStatus fails for status code
    axios.head = async (url, config) => {
      if (config.validateStatus && !config.validateStatus(status)) {
        const err = new Error(`Request failed with status code ${status}`)
        err.response = { status }
        throw err
      }
      return { status }
    }

    axios.get = async (url, config) => {
      if (config.validateStatus && !config.validateStatus(status)) {
        const err = new Error(`Request failed with status code ${status}`)
        err.response = { status }
        throw err
      }
      return { status }
    }

    try {
      await pool._pingProxy(testP, 'soundcloud')
      assert(
        `HTTP ${status} response rejected for SoundCloud ping (latency remains Infinity)`,
        testP.latencyMap.soundcloud === Infinity,
        `SoundCloud latencyMap: ${testP.latencyMap.soundcloud}`
      )

      await pool._pingProxy(testP, 'youtube')
      assert(
        `HTTP ${status} response rejected for YouTube ping (latency remains Infinity)`,
        testP.latencyMap.youtube === Infinity,
        `YouTube latencyMap: ${testP.latencyMap.youtube}`
      )

      assert(
        `HTTP ${status} overall latency remains Infinity`,
        testP.latency === Infinity,
        `Overall latency: ${testP.latency}`
      )
    } finally {
      axios.head = originalHead
      axios.get = originalGet
    }
  }

  // Also verify that if a proxy previously had numeric latency, an HTTP 500/502/403/429 resets latencyMap[service] to Infinity
  resetPool()
  const pWithLatency = pool.proxies[0]
  pool.updateLatency(pWithLatency, 'soundcloud', 150)
  assert('Pre-condition: Proxy SoundCloud latency set to 150ms', pWithLatency.latencyMap.soundcloud === 150)

  axios.head = async (url, config) => {
    const err = new Error('Request failed with status code 500')
    err.response = { status: 500 }
    throw err
  }

  try {
    await pool._pingProxy(pWithLatency, 'soundcloud')
    assert(
      'Failed ping (HTTP 500) resets existing latency back to Infinity',
      pWithLatency.latencyMap.soundcloud === Infinity,
      `latencyMap.soundcloud: ${pWithLatency.latencyMap.soundcloud}`
    )
  } finally {
    axios.head = originalHead
  }


  // ---------------------------------------------------------------------------
  // REQUIREMENT 4: In-flight pings discarding updates when stopPingLoop() / close() is called
  // ---------------------------------------------------------------------------
  console.log('\n--- Category 4: In-Flight Ping Discarding on Stop / Close ---')

  // Test 4.1: stopPingLoop() called while ping is in-flight
  resetPool()
  const inFlightP1 = pool.proxies[0]
  let resolveInFlight1

  axios.head = () => new Promise(resolve => {
    resolveInFlight1 = resolve
  })

  try {
    // Launch background ping (do not await immediately)
    const pingPromise1 = pool._pingProxy(inFlightP1, 'soundcloud')

    // Verify ping is in-flight and latency is still Infinity
    assert('Pre-condition: Latency is Infinity while ping is in-flight', inFlightP1.latencyMap.soundcloud === Infinity)

    // Call stopPingLoop() while ping is in-flight
    pool.stopPingLoop()
    assert('_stopRequested is true after stopPingLoop()', pool._stopRequested === true)

    // Now resolve the HTTP request with 200 OK
    resolveInFlight1({ status: 200, data: 'OK' })
    await pingPromise1

    // Verify update was discarded because stopPingLoop() was invoked while request was in-flight
    assert(
      'In-flight ping updates DISCARDED when stopPingLoop() called (latency remains Infinity)',
      inFlightP1.latencyMap.soundcloud === Infinity,
      `latencyMap.soundcloud: ${inFlightP1.latencyMap.soundcloud}`
    )
  } finally {
    axios.head = originalHead
  }

  // Test 4.2: close() / destroy() called while ping is in-flight
  resetPool()
  const inFlightP2 = pool.proxies[1]
  let resolveInFlight2

  axios.get = () => new Promise(resolve => {
    resolveInFlight2 = resolve
  })

  try {
    const pingPromise2 = pool._pingProxy(inFlightP2, 'youtube')

    // Call close() while ping is in-flight
    pool.close()
    assert('_stopRequested is true after close()', pool._stopRequested === true)

    // Resolve the HTTP request with 204 No Content
    resolveInFlight2({ status: 204, data: '' })
    await pingPromise2

    assert(
      'In-flight ping updates DISCARDED when close() called (latency remains Infinity)',
      inFlightP2.latencyMap.youtube === Infinity,
      `latencyMap.youtube: ${inFlightP2.latencyMap.youtube}`
    )
  } finally {
    axios.get = originalGet
  }

  // Final Summary
  console.log('\n====================================================')
  console.log(` VERDICT: ${passedTests === totalTests ? 'PASS' : 'FAIL'}`)
  console.log(` Summary: Passed ${passedTests} / ${totalTests} tests`)
  console.log('====================================================')

  return {
    verdict: passedTests === totalTests ? 'PASS' : 'FAIL',
    totalTests,
    passedTests,
    results
  }
}

if (require.main === module) {
  runEmpiricalHarness()
    .then(res => {
      process.exit(res.verdict === 'PASS' ? 0 : 1)
    })
    .catch(err => {
      console.error('Harness execution error:', err)
      process.exit(1)
    })
}

module.exports = runEmpiricalHarness
