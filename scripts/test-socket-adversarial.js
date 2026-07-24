const http = require('http');
const { io: ioClient } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const { sendToUser, broadcast } = require('../src/socket');

const JWT_SECRET = process.env.JWT_SECRET || 'testjwt';

function generateToken(payload = { userId: 'test_user_1' }, secret = JWT_SECRET, expiresIn = '1h') {
  return jwt.sign(payload, secret, { expiresIn });
}

async function runAdversarialTests() {
  console.log('====================================================');
  console.log('   Lunex Backend — Adversarial Verification Suite');
  console.log('====================================================');

  const server = app.server;
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://localhost:${port}`;
  console.log(`[Setup] Server listening on ${serverUrl}`);

  let passedAll = true;

  // ----------------------------------------------------
  // Task 1: CORS Enforcement Tests
  // ----------------------------------------------------
  console.log('\n--- Task 1: CORS Configuration Verification ---');
  
  // Test 1.1: Allowed Origin
  try {
    const token = generateToken({ userId: 'cors_user_allowed' });
    const client = ioClient(serverUrl, {
      auth: { token },
      extraHeaders: { origin: 'http://localhost:3000' },
      transports: ['polling', 'websocket'],
      reconnection: false,
      timeout: 2000
    });

    await new Promise((resolve, reject) => {
      client.on('connect', () => {
        console.log('✅ [PASS] Task 1.1: Connection with allowed Origin (http://localhost:3000) succeeded');
        client.disconnect();
        resolve();
      });
      client.on('connect_error', (err) => {
        client.disconnect();
        reject(new Error(`Allowed origin rejected: ${err.message}`));
      });
    });
  } catch (err) {
    console.error(`❌ [FAIL] Task 1.1: ${err.message}`);
    passedAll = false;
  }

  // Test 1.2: Disallowed Origin
  try {
    const token = generateToken({ userId: 'cors_user_disallowed' });
    const client = ioClient(serverUrl, {
      auth: { token },
      extraHeaders: { origin: 'http://malicious-attacker-site.com' },
      transports: ['polling'], // force HTTP polling to trigger CORS header check on handshake
      reconnection: false,
      timeout: 2000
    });

    await new Promise((resolve, reject) => {
      client.on('connect', () => {
        client.disconnect();
        reject(new Error('Disallowed origin was unexpectedly allowed!'));
      });
      client.on('connect_error', (err) => {
        console.log(`✅ [PASS] Task 1.2: Connection with disallowed Origin (http://malicious-attacker-site.com) blocked as expected (${err.message})`);
        client.disconnect();
        resolve();
      });
    });
  } catch (err) {
    console.error(`❌ [FAIL] Task 1.2: ${err.message}`);
    passedAll = false;
  }

  // ----------------------------------------------------
  // Task 2: Handshake Token Passing Variations
  // ----------------------------------------------------
  console.log('\n--- Task 2: Token Passing Variations ---');

  // Test 2.1: auth: { token }
  try {
    const token = generateToken({ userId: 'token_user_auth' });
    const client = ioClient(serverUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 2000
    });

    await new Promise((resolve, reject) => {
      client.on('connect', () => {
        console.log('✅ [PASS] Task 2.1: Token via auth: { token } succeeded');
        client.disconnect();
        resolve();
      });
      client.on('connect_error', (err) => {
        client.disconnect();
        reject(err);
      });
    });
  } catch (err) {
    console.error(`❌ [FAIL] Task 2.1: ${err.message}`);
    passedAll = false;
  }

  // Test 2.2: extraHeaders: { authorization: 'Bearer ...' }
  try {
    const token = generateToken({ userId: 'token_user_header' });
    const client = ioClient(serverUrl, {
      extraHeaders: { authorization: `Bearer ${token}` },
      transports: ['websocket'],
      reconnection: false,
      timeout: 2000
    });

    await new Promise((resolve, reject) => {
      client.on('connect', () => {
        console.log('✅ [PASS] Task 2.2: Token via extraHeaders: { authorization: "Bearer ..." } succeeded');
        client.disconnect();
        resolve();
      });
      client.on('connect_error', (err) => {
        client.disconnect();
        reject(err);
      });
    });
  } catch (err) {
    console.error(`❌ [FAIL] Task 2.2: ${err.message}`);
    passedAll = false;
  }

  // Test 2.3: query: { token }
  try {
    const token = generateToken({ userId: 'token_user_query' });
    const client = ioClient(serverUrl, {
      query: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 2000
    });

    await new Promise((resolve, reject) => {
      client.on('connect', () => {
        console.log('✅ [PASS] Task 2.3: Token via query: { token } succeeded');
        client.disconnect();
        resolve();
      });
      client.on('connect_error', (err) => {
        client.disconnect();
        reject(err);
      });
    });
  } catch (err) {
    console.error(`❌ [FAIL] Task 2.3: ${err.message}`);
    passedAll = false;
  }

  // ----------------------------------------------------
  // Task 3: Targeted Broadcasting (sendToUser)
  // ----------------------------------------------------
  console.log('\n--- Task 3: Targeted Broadcasting Verification ---');

  try {
    const userA_id = 'user_alpha_77';
    const userB_id = 'user_beta_88';

    const tokenA = generateToken({ userId: userA_id });
    const tokenB = generateToken({ userId: userB_id });

    const clientA = ioClient(serverUrl, { auth: { token: tokenA }, transports: ['websocket'] });
    const clientB = ioClient(serverUrl, { auth: { token: tokenB }, transports: ['websocket'] });

    await Promise.all([
      new Promise((res) => clientA.on('connect', res)),
      new Promise((res) => clientB.on('connect', res))
    ]);

    let userAReceived = false;
    let userBReceived = false;

    clientA.on('targeted_event', (payload) => {
      userAReceived = payload;
    });

    clientB.on('targeted_event', (payload) => {
      userBReceived = payload;
    });

    const targetPayload = { secretMsg: 'For User A only', timestamp: Date.now() };

    // Emit targeted message to User A
    sendToUser(userA_id, 'targeted_event', targetPayload);

    // Wait 500ms to verify reception isolation
    await new Promise((res) => setTimeout(res, 500));

    clientA.disconnect();
    clientB.disconnect();

    if (userAReceived && userAReceived.secretMsg === targetPayload.secretMsg && !userBReceived) {
      console.log('✅ [PASS] Task 3: sendToUser correctly targeted User A; User B received nothing');
    } else {
      throw new Error(`Targeted broadcast isolation failure: User A received=${!!userAReceived}, User B received=${!!userBReceived}`);
    }
  } catch (err) {
    console.error(`❌ [FAIL] Task 3: ${err.message}`);
    passedAll = false;
  }

  // Cleanup server
  await new Promise((resolve) => server.close(resolve));

  console.log('\n====================================================');
  if (passedAll) {
    console.log(' OVERALL ADVERSARIAL VERDICT: PASS');
  } else {
    console.log(' OVERALL ADVERSARIAL VERDICT: FAIL');
  }
  console.log('====================================================\n');

  if (!passedAll) {
    process.exit(1);
  }
}

runAdversarialTests().catch((err) => {
  console.error('Fatal error during adversarial tests:', err);
  process.exit(1);
});
