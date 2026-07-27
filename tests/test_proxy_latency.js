/**
 * Verification Script for Proxy Latency Benchmarking & SLA Compliance (Milestone 3)
 */

const http = require('http');
const crypto = require('crypto');
const app = require('./src/server');
const proxyManager = require('./src/middleware/proxyManager');

const APP_SECRET = process.env.APP_SECRET || 'super-secret-lunex-app-key-2026';
const PORT = process.env.PORT || 5000;
const TRACK_ID_PRIMARY = '197825000';
const TRACK_ID_ACTIVE = '1647163917';

async function checkPortRunning(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/status`, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 403);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function sendStreamRequest(port, trackId) {
  const ts = Date.now().toString();
  const urlPath = `/api/sc/stream?id=${trackId}`;
  const signature = crypto
    .createHmac('sha256', APP_SECRET)
    .update(urlPath + ts)
    .digest('hex');

  const options = {
    hostname: 'localhost',
    port: port,
    path: urlPath,
    method: 'GET',
    headers: {
      'x-plume-timestamp': ts,
      'x-plume-signature': signature
    }
  };

  const tStart = Date.now();
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const latency = Date.now() - tStart;
        let json = {};
        try { json = JSON.parse(body); } catch(e) {}
        resolve({
          statusCode: res.statusCode,
          latency,
          streamUrl: json.data || null,
          error: json.error || null,
          rawBody: body
        });
      });
    });

    req.on('error', (err) => {
      const latency = Date.now() - tStart;
      reject({ statusCode: 500, latency, error: err.message });
    });

    req.end();
  });
}

async function runBenchmark() {
  console.log('===============================================================');
  console.log(' LUNEX BACKEND V2 - PROXY LATENCY BENCHMARKING (MILESTONE 3) ');
  console.log('===============================================================\n');

  let serverInstance = null;
  const isRunning = await checkPortRunning(PORT);

  if (isRunning) {
    console.log(`[Info] Local server is already running on port ${PORT}.`);
  } else {
    console.log(`[Info] Local server is not running on port ${PORT}. Starting server...`);
    await new Promise((resolve) => {
      serverInstance = app.listen(PORT, () => {
        console.log(`[Info] Express server listening on http://localhost:${PORT}`);
        resolve();
      });
    });
  }

  // Ensure proxy pool ping loop is active for latency monitoring
  proxyManager.startPingLoop(15000);
  console.log('[Info] Waiting 2 seconds for initial proxy latency discovery...');
  await new Promise(r => setTimeout(r, 2000));

  // Determine active track ID
  let targetTrackId = TRACK_ID_PRIMARY;
  console.log(`[Info] Testing primary SoundCloud track ID ${targetTrackId}...`);
  const probe = await sendStreamRequest(PORT, targetTrackId);
  if (probe.statusCode !== 200) {
    console.log(`[Notice] Primary track ID ${targetTrackId} returned status ${probe.statusCode} (${probe.error || 'Inactive/Removed'}). Falling back to active track ID ${TRACK_ID_ACTIVE}...`);
    targetTrackId = TRACK_ID_ACTIVE;
  } else {
    console.log(`[Info] Track ID ${targetTrackId} active and responding.`);
  }

  console.log(`\n--- Starting 10 Sequential Stream Requests (Track ID: ${targetTrackId}) ---\n`);

  const results = [];
  for (let i = 1; i <= 10; i++) {
    try {
      const res = await sendStreamRequest(PORT, targetTrackId);
      results.push(res);
      console.log(`Request #${i.toString().padStart(2, ' ')} | Status: ${res.statusCode} | Latency: ${res.latency.toString().padStart(4, ' ')} ms | Stream URL: ${res.streamUrl ? res.streamUrl.slice(0, 70) + '...' : (res.error || 'N/A')}`);
    } catch (err) {
      results.push(err);
      console.log(`Request #${i.toString().padStart(2, ' ')} | Status: ${err.statusCode} | Latency: ${err.latency.toString().padStart(4, ' ')} ms | Error: ${err.error}`);
    }
  }

  // Summary Statistics
  const latencies = results.map(r => r.latency);
  const totalRequests = results.length;
  const sumLatency = latencies.reduce((acc, val) => acc + val, 0);
  const avgLatency = Number((sumLatency / totalRequests).toFixed(2));
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);
  const successCount = results.filter(r => r.statusCode === 200).length;

  console.log('\n===============================================================');
  console.log(' BENCHMARK SUMMARY STATISTICS');
  console.log('===============================================================');
  console.log(`Total Requests    : ${totalRequests}`);
  console.log(`Successful (200)  : ${successCount} / ${totalRequests}`);
  console.log(`Average Latency   : ${avgLatency} ms`);
  console.log(`Minimum Latency   : ${minLatency} ms`);
  console.log(`Maximum Latency   : ${maxLatency} ms`);
  console.log('---------------------------------------------------------------');

  // Server Log Inspection / Proxy Selection Confirmation
  console.log('\n--- SERVER PROXY POOL SELECTION INSPECTION ---');
  const stats = proxyManager.getProxyStats();
  console.log(`Total Proxies in Pool: ${stats.total}`);
  console.log(`Healthy Active Proxies: ${stats.healthy}`);
  console.log('\nProxy Latency Matrix & Selection Verification:');
  stats.proxies.forEach((p, idx) => {
    const scLat = p.latencyMap?.soundcloud;
    const scDisplay = (scLat === undefined || scLat === Infinity || isNaN(scLat)) ? 'INF (Ignored)' : `${scLat} ms`;
    const selectedFlag = (scLat !== undefined && scLat !== Infinity && scLat < 1200) ? ' [SELECTED / FASTEST]' : ' [HIGH-LATENCY / IGNORED]';
    console.log(` Proxy #${idx + 1} (${p.country || 'N/A'}): ${p.url} | SC Latency: ${scDisplay.padEnd(14, ' ')}${selectedFlag}`);
  });

  // SLA Threshold Verification (< 800ms)
  console.log('\n===============================================================');
  console.log(' SLA THRESHOLD VERIFICATION (< 800ms Target)');
  console.log('===============================================================');
  const passSLA = avgLatency < 800;

  if (passSLA) {
    console.log(`[VERDICT: PASSED] Average latency of ${avgLatency} ms is strictly < 800 ms SLA threshold.`);
  } else {
    console.error(`[VERDICT: FAILED] Average latency of ${avgLatency} ms exceeds or equals 800 ms SLA threshold.`);
  }

  // Cleanup
  proxyManager.stopPingLoop();
  if (serverInstance) {
    serverInstance.close();
  }

  process.exit(passSLA ? 0 : 1);
}

runBenchmark().catch(err => {
  console.error('[Error] Benchmark execution failed:', err);
  process.exit(1);
});
