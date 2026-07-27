const path = require('path');
const axios = require('axios');
const proxyManager = require('../../src/middleware/proxyManager');

const testResults = [];

function recordResult(testName, passed, details) {
  testResults.push({ testName, passed, details });
  const statusStr = passed ? '[PASS]' : '[FAIL]';
  console.log(`${statusStr} ${testName}`);
  if (details) {
    console.log(`   Details: ${JSON.stringify(details, null, 2)}`);
  }
}

async function runHarness() {
  console.log('=====================================================');
  console.log('  MILESTONE 2 ADVERSARIAL TEST HARNESS (CHALLENGER 2)');
  console.log('=====================================================\n');

  const pool = proxyManager._pool;

  function resetPool() {
    pool.stopPingLoop();
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
      }
    ];
    pool.cursor = 0;
  }

  // Save original axios methods
  const origHead = axios.head;
  const origGet = axios.get;

  // ---------------------------------------------------------------------------
  // TEST GROUP 1: EMA Mathematical Convergence & Boundary Conditions
  // ---------------------------------------------------------------------------
  console.log('--- TEST GROUP 1: EMA Mathematical Convergence & Boundaries ---');
  resetPool();

  const proxy1 = pool.proxies[0];
  const alpha = 0.7;
  const mockLatencies = [
    100, 120, 150, 130, 200, 180, 160, 140, 150, 150,
    150, 150, 150, 150, 150, 150, 150, 150, 150, 150
  ];

  let calculatedEMA = Infinity;
  let emaMatchFailed = false;
  const emaStepLog = [];

  for (let i = 0; i < mockLatencies.length; i++) {
    const rawVal = mockLatencies[i];
    if (calculatedEMA === Infinity) {
      calculatedEMA = Math.round(rawVal);
    } else {
      calculatedEMA = Math.round(alpha * rawVal + (1 - alpha) * calculatedEMA);
    }

    pool.updateLatency(proxy1.url, 'soundcloud', rawVal);
    const actualEMA = proxy1.latencyMap.soundcloud;

    emaStepLog.push({ step: i + 1, input: rawVal, expected: calculatedEMA, actual: actualEMA });

    if (actualEMA !== calculatedEMA) {
      emaMatchFailed = true;
    }
  }

  const finalTargetValue = mockLatencies[mockLatencies.length - 1];
  const finalActualValue = proxy1.latencyMap.soundcloud;
  const isConverged = Math.abs(finalActualValue - finalTargetValue) <= 1;

  recordResult(
    'EMA Step-by-Step Mathematical Formula Verification (20 updates)',
    !emaMatchFailed,
    { stepsCount: mockLatencies.length, stepLog: emaStepLog.slice(0, 5) }
  );

  recordResult(
    'EMA Mathematical Convergence to Target Latency (150ms)',
    isConverged,
    { target: finalTargetValue, actual: finalActualValue }
  );

  // Test 1C: Edge case inputs (NaN poisoning test)
  resetPool();
  let nanCorrupted = false;
  pool.updateLatency(proxy1.url, 'soundcloud', 100);
  pool.updateLatency(proxy1.url, 'soundcloud', NaN);
  if (isNaN(proxy1.latencyMap.soundcloud)) {
    nanCorrupted = true;
  }
  // Try subsequent update after NaN
  pool.updateLatency(proxy1.url, 'soundcloud', 120);
  if (isNaN(proxy1.latencyMap.soundcloud)) {
    nanCorrupted = true;
  }

  recordResult(
    'EMA NaN Input Resistance (Prevents Permanent EMA Corruption)',
    !nanCorrupted,
    {
      latencyAfterNaN: proxy1.latencyMap.soundcloud,
      note: nanCorrupted ? 'NaN input permanently corrupted latencyMap to NaN' : 'Handled gracefully'
    }
  );

  // ---------------------------------------------------------------------------
  // TEST GROUP 2: Bug Analysis - _findProxy Object Incompatibility in _pingProxy
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: _pingProxy & updateLatency Protocol Contract ---');
  resetPool();

  axios.head = async function() {
    return { status: 200, data: 'OK' };
  };

  // Run _pingProxy with successful mock
  await pool._pingProxy(pool.proxies[0], 'soundcloud');

  // Check if latencyMap was updated or remained Infinity
  const scLatencyAfterPing = pool.proxies[0].latencyMap.soundcloud;
  const pingUpdateSuccessful = typeof scLatencyAfterPing === 'number' && scLatencyAfterPing !== Infinity;

  recordResult(
    '_pingProxy calls updateLatency with proxy object (_findProxy compatibility check)',
    pingUpdateSuccessful,
    {
      latencyMapSoundcloud: scLatencyAfterPing,
      explanation: pingUpdateSuccessful
        ? 'Ping loop successfully updated latencyMap'
        : 'CRITICAL BUG: _pingProxy passes proxy object to updateLatency, but _findProxy fails to resolve proxy object, returning null and discarding latency update!'
    }
  );

  // Restore axios for next tests
  axios.head = origHead;

  // ---------------------------------------------------------------------------
  // TEST GROUP 3: Network Timeout Enforcement & HTTP Status Error Handling
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Ping Loop Network Timeout & Error Handling ---');

  // 3A: 3000ms Timeout Enforcement & Fallback Delay Cumulative Impact
  resetPool();
  let soundcloudCallCount = 0;
  axios.head = async function(url, config) {
    soundcloudCallCount++;
    const err = new Error('timeout of 3000ms exceeded');
    err.code = 'ECONNABORTED';
    throw err;
  };
  axios.get = async function(url, config) {
    const err = new Error('timeout of 3000ms exceeded');
    err.code = 'ECONNABORTED';
    throw err;
  };

  const startTimeoutTest = Date.now();
  await pool._pingProxy(pool.proxies[0], 'soundcloud');
  const elapsedTimeout = Date.now() - startTimeoutTest;

  // Soundcloud ping attempts primary and fallback, so soundcloudCallCount should be 2
  recordResult(
    'Ping Loop Soundcloud Fallback Cascade on Timeout (Primary + Fallback)',
    soundcloudCallCount === 2,
    {
      attemptsCount: soundcloudCallCount,
      elapsedMs: elapsedTimeout,
      note: 'Primary timeout (3000ms) + Fallback timeout (3000ms) = 6000ms max latency per proxy on soundcloud'
    }
  );

  // 3B: HTTP 500 Error Status Handling (validateStatus check)
  resetPool();
  axios.head = async function() {
    return {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {},
      data: 'Error'
    };
  };

  let updateLatencyCalledWith500 = false;
  const origUpdateLatency = pool.updateLatency;
  pool.updateLatency = function(agentOrUrl, service, latencyMs) {
    updateLatencyCalledWith500 = true;
    return origUpdateLatency.call(this, agentOrUrl, service, latencyMs);
  };

  await pool._pingProxy(pool.proxies[0], 'soundcloud');
  pool.updateLatency = origUpdateLatency;

  recordResult(
    'Ping Loop HTTP 500 Server Error Treatment (validateStatus check)',
    !updateLatencyCalledWith500,
    {
      updateLatencyTriggeredForHTTP500: updateLatencyCalledWith500,
      explanation: updateLatencyCalledWith500
        ? 'CRITICAL FAILURE: validateStatus () => true causes axios to return HTTP 500 responses as valid, flagging failed server as successful ping!'
        : 'HTTP 500 correctly treated as failure'
    }
  );

  // Restore axios
  axios.head = origHead;
  axios.get = origGet;

  // ---------------------------------------------------------------------------
  // TEST GROUP 4: Timer & Memory Leak Checks (startPingLoop / stopPingLoop)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Ping Loop Lifecycle & Leak Prevention ---');
  resetPool();

  // 4A: Start and Stop Timer Cleanup
  pool.startPingLoop(1000);
  const intervalCreated = pool.pingInterval !== null;
  pool.stopPingLoop();
  const intervalCleared = pool.pingInterval === null;

  recordResult(
    'startPingLoop / stopPingLoop Interval Creation and Nullification',
    intervalCreated && intervalCleared,
    { intervalCreated, intervalCleared }
  );

  // 4B: Idempotent startPingLoop (no duplicate timers)
  resetPool();
  pool.startPingLoop(1000);
  const handle1 = pool.pingInterval;
  pool.startPingLoop(1000);
  const handle2 = pool.pingInterval;
  const isIdempotent = handle1 === handle2;
  pool.stopPingLoop();

  recordResult(
    'startPingLoop Idempotency (Prevents Duplicate Active Intervals)',
    isIdempotent,
    { handle1IsHandle2: isIdempotent }
  );

  // 4C: In-Flight Async Task Leak after stopPingLoop
  resetPool();
  let inFlightExecutedAfterStop = false;
  axios.head = async function() {
    await new Promise(r => setTimeout(r, 150));
    inFlightExecutedAfterStop = true;
    return { status: 200, data: 'OK' };
  };

  pool.startPingLoop(1000); // Triggers background _pingAll()
  pool.stopPingLoop(); // Stop interval timer immediately

  await new Promise(r => setTimeout(r, 250)); // Wait for in-flight request to resolve

  recordResult(
    'In-Flight Async Task Cleanup on stopPingLoop (No Uncancelled Background Pings)',
    !inFlightExecutedAfterStop,
    {
      inFlightExecutedAfterStop,
      explanation: inFlightExecutedAfterStop
        ? 'WARN: stopPingLoop clears interval timer but does not abort in-flight HTTP requests, which continue running asynchronously'
        : 'In-flight tasks cancelled'
    }
  );

  // Restore axios
  axios.head = origHead;
  axios.get = origGet;

  // ---------------------------------------------------------------------------
  // SUMMARY AND VERDICT
  // ---------------------------------------------------------------------------
  console.log('\n=====================================================');
  console.log('  SUMMARY OF RESULTS');
  console.log('=====================================================');

  const failedTests = testResults.filter(r => !r.passed);
  const overallPass = failedTests.length === 0;

  console.log(`Total Tests Run: ${testResults.length}`);
  console.log(`Passed: ${testResults.length - failedTests.length}`);
  console.log(`Failed: ${failedTests.length}`);
  console.log(`OVERALL VERDICT: ${overallPass ? 'PASS' : 'FAIL'}\n`);

  if (failedTests.length > 0) {
    console.log('Failed Tests List:');
    failedTests.forEach(f => {
      console.log(` - ${f.testName}`);
      console.log(`   Details: ${JSON.stringify(f.details, null, 2)}`);
    });
  }

  return {
    overallPass,
    total: testResults.length,
    passed: testResults.length - failedTests.length,
    failed: failedTests.length,
    results: testResults
  };
}

if (require.main === module) {
  runHarness().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('Harness execution failed:', err);
    process.exit(1);
  });
}

module.exports = { runHarness };
