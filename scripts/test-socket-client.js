#!/usr/bin/env node

/**
 * Standalone CLI Test Script for Socket.io WebSocket Layer
 * Execution: node scripts/test-socket-client.js [optional_server_url]
 */

require('dotenv').config();
const { io } = require('socket.io-client');
const jwt = require('jsonwebtoken');

const SERVER_URL = process.argv[2] || process.env.SOCKET_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'testjwt';

console.log('====================================================');
console.log(' Lunex Backend — Socket.io CLI Verification Tool');
console.log('====================================================');
console.log(`[Config] Target Server URL: ${SERVER_URL}`);
console.log(`[Config] JWT Secret: ${JWT_SECRET ? '*** configured ***' : 'MISSING'}`);

function generateToken(payload = { userId: 'cli_test_user', role: 'admin' }, expiresIn = '1h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

async function runCliTest() {
  const token = generateToken();
  console.log(`[Auth] Generated test JWT token: ${token.substring(0, 20)}...`);

  console.log(`\n[Test 1] Attempting authenticated connection to ${SERVER_URL}...`);

  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 3000
    });

    const timeoutTimer = setTimeout(() => {
      socket.disconnect();
      console.error('❌ [FAIL] Connection timed out after 3000ms.');
      reject(new Error('Connection timeout'));
    }, 4000);

    socket.on('connect', () => {
      clearTimeout(timeoutTimer);
      console.log(`✅ [PASS] Connected successfully!`);
      console.log(`   Socket ID: ${socket.id}`);
      if (socket.io && socket.io.engine) {
        console.log(`   Transport: ${socket.io.engine.transport.name}`);
      }

      // Test event listener
      socket.on('pong_test', (data) => {
        console.log(`✅ [PASS] Received pong_test event:`, data);
      });

      console.log(`\n[Test 2] Testing ping emission...`);
      socket.emit('ping_test', { timestamp: Date.now() });

      setTimeout(() => {
        console.log(`\n[Cleanup] Disconnecting client cleanly...`);
        socket.disconnect();
        console.log(`✅ [PASS] Client disconnected cleanly.`);
        resolve(true);
      }, 1000);
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timeoutTimer);
      console.error(`❌ [FAIL] Connection error: ${err.message}`);
      if (err.data) {
        console.error(`   Details:`, err.data);
      }
      socket.disconnect();
      reject(err);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Info] Socket disconnected. Reason: ${reason}`);
    });
  });
}

runCliTest()
  .then(() => {
    console.log('\n====================================================');
    console.log(' RESULT: ALL CLI TESTS PASSED');
    console.log('====================================================');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n====================================================');
    console.error(' RESULT: CLI VERIFICATION FAILED');
    console.error(` Error: ${err.message}`);
    console.error(' (Note: Backend socket server might not be running or implemented yet)');
    console.error('====================================================');
    process.exit(1);
  });
