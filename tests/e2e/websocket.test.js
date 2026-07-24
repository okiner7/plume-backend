const http = require('http');
const ioClient = require('socket.io-client');
const jwt = require('jsonwebtoken');
const app = require('../../src/server');

const JWT_SECRET = process.env.JWT_SECRET || 'testjwt';

function generateToken(payload = { userId: 'user_test_123', role: 'user' }, secret = JWT_SECRET, expiresIn = '1h') {
  return jwt.sign(payload, secret, { expiresIn });
}

describe('Socket.io E2E Test Suite', () => {
  let server;
  let serverUrl;
  let socketModule = null;
  let ioServer = null;

  beforeAll((done) => {
    // Attempt to load backend socket module dynamically if present
    const socketModulePaths = [
      '../../src/websocket',
      '../../src/socket',
      '../../src/services/socket',
      '../../src/services/websocket',
      '../../src/services/socket/index',
      '../../src/websocket/index'
    ];

    for (const modPath of socketModulePaths) {
      try {
        socketModule = require(modPath);
        break;
      } catch (e) {
        // Ignore module resolution errors when socket implementation is not present yet
      }
    }

    server = http.createServer(app);

    if (socketModule) {
      if (typeof socketModule.init === 'function') {
        ioServer = socketModule.init(server);
      } else if (typeof socketModule.initSocket === 'function') {
        ioServer = socketModule.initSocket(server);
      } else if (typeof socketModule.setupWebSocket === 'function') {
        ioServer = socketModule.setupWebSocket(server);
      } else if (typeof socketModule === 'function') {
        ioServer = socketModule(server);
      }
    }

    server.listen(0, () => {
      const port = server.address().port;
      serverUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    if (ioServer && typeof ioServer.close === 'function') {
      ioServer.close();
    }
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  function createClient(options = {}) {
    return ioClient(serverUrl, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 2000,
      ...options
    });
  }

  // Tier 1 — Feature Coverage
  describe('Tier 1: Valid JWT Connection', () => {
    test('Test 1.1: Connect with valid JWT in auth.token', (done) => {
      const token = generateToken({ userId: 'tier1_user_1' });
      const client = createClient({ auth: { token } });

      client.on('connect', () => {
        expect(client.connected).toBe(true);
        client.disconnect();
        done();
      });

      client.on('connect_error', (err) => {
        client.disconnect();
        done(err);
      });
    });

    test('Test 1.2: Connect with valid JWT in headers.authorization', (done) => {
      const token = generateToken({ userId: 'tier1_user_2' });
      const client = createClient({
        extraHeaders: { authorization: `Bearer ${token}` }
      });

      client.on('connect', () => {
        expect(client.connected).toBe(true);
        client.disconnect();
        done();
      });

      client.on('connect_error', (err) => {
        client.disconnect();
        done(err);
      });
    });

    test('Test 1.3: Connect with valid JWT in query.token', (done) => {
      const token = generateToken({ userId: 'tier1_user_3' });
      const client = createClient({
        query: { token }
      });

      client.on('connect', () => {
        expect(client.connected).toBe(true);
        client.disconnect();
        done();
      });

      client.on('connect_error', (err) => {
        client.disconnect();
        done(err);
      });
    });

    test('Test 1.4: Verify connection event fires and connect event received by client', (done) => {
      const token = generateToken({ userId: 'tier1_user_4' });
      const client = createClient({ auth: { token } });
      let eventFired = false;

      client.on('connect', () => {
        eventFired = true;
        expect(client.connected).toBe(true);
        expect(eventFired).toBe(true);
        client.disconnect();
        done();
      });

      client.on('connect_error', (err) => {
        client.disconnect();
        done(err);
      });
    });

    test('Test 1.5: Verify socket ID is assigned upon successful handshake', (done) => {
      const token = generateToken({ userId: 'tier1_user_5' });
      const client = createClient({ auth: { token } });

      client.on('connect', () => {
        expect(client.id).toBeDefined();
        expect(typeof client.id).toBe('string');
        expect(client.id.length).toBeGreaterThan(0);
        client.disconnect();
        done();
      });

      client.on('connect_error', (err) => {
        client.disconnect();
        done(err);
      });
    });
  });

  // Tier 2 — Boundary & Corner Cases (Auth Rejection)
  describe('Tier 2: Auth Rejection Cases', () => {
    test('Test 2.1: Connect without any token -> rejected with Authentication error', (done) => {
      const client = createClient({ auth: {} });

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Connection should have been rejected'));
      });

      client.on('connect_error', (err) => {
        expect(err).toBeDefined();
        client.disconnect();
        done();
      });
    });

    test('Test 2.2: Connect with invalid token string -> rejected', (done) => {
      const client = createClient({ auth: { token: 'invalid_token_123' } });

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Connection with invalid token should be rejected'));
      });

      client.on('connect_error', (err) => {
        expect(err).toBeDefined();
        client.disconnect();
        done();
      });
    });

    test('Test 2.3: Connect with token signed using wrong secret -> rejected', (done) => {
      const wrongToken = generateToken({ userId: 'wrong_secret_user' }, 'wrong_secret_key_999');
      const client = createClient({ auth: { token: wrongToken } });

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Connection with wrong secret token should be rejected'));
      });

      client.on('connect_error', (err) => {
        expect(err).toBeDefined();
        client.disconnect();
        done();
      });
    });

    test('Test 2.4: Connect with expired token -> rejected', (done) => {
      const expiredToken = generateToken({ userId: 'expired_user' }, JWT_SECRET, '-1s');
      const client = createClient({ auth: { token: expiredToken } });

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Connection with expired token should be rejected'));
      });

      client.on('connect_error', (err) => {
        expect(err).toBeDefined();
        client.disconnect();
        done();
      });
    });

    test('Test 2.5: Connect with empty auth object -> rejected', (done) => {
      const client = createClient({ auth: {}, extraHeaders: {}, query: {} });

      client.on('connect', () => {
        client.disconnect();
        done(new Error('Connection with empty auth should be rejected'));
      });

      client.on('connect_error', (err) => {
        expect(err).toBeDefined();
        client.disconnect();
        done();
      });
    });
  });

  // Tier 3 — Event Broadcasting
  describe('Tier 3: Cross-Feature & Event Broadcasting', () => {
    test('Test 3.1: Single authenticated client receives broadcasted event from backend module', (done) => {
      const token = generateToken({ userId: 'broadcast_user_1' });
      const client = createClient({ auth: { token } });

      const testPayload = { message: 'Hello from backend', timestamp: Date.now() };

      client.on('connect', () => {
        client.on('test_broadcast', (data) => {
          expect(data).toEqual(testPayload);
          client.disconnect();
          done();
        });

        if (socketModule && typeof socketModule.broadcast === 'function') {
          socketModule.broadcast('test_broadcast', testPayload);
        } else if (ioServer) {
          ioServer.emit('test_broadcast', testPayload);
        } else {
          client.disconnect();
          done(new Error('Backend socket layer broadcast function not implemented yet'));
        }
      });

      client.on('connect_error', (err) => {
        client.disconnect();
        done(err);
      });
    });

    test('Test 3.2: Multiple connected authenticated clients all receive broadcasted event simultaneously', (done) => {
      const token1 = generateToken({ userId: 'multi_user_1' });
      const token2 = generateToken({ userId: 'multi_user_2' });
      const token3 = generateToken({ userId: 'multi_user_3' });

      const client1 = createClient({ auth: { token: token1 } });
      const client2 = createClient({ auth: { token: token2 } });
      const client3 = createClient({ auth: { token: token3 } });

      const clients = [client1, client2, client3];
      let receivedCount = 0;
      const testPayload = { type: 'ANNOUNCEMENT', text: 'Multi-client test' };

      function checkDone() {
        receivedCount++;
        if (receivedCount === 3) {
          clients.forEach(c => c.disconnect());
          done();
        }
      }

      let connectedCount = 0;
      clients.forEach(client => {
        client.on('connect_error', (err) => {
          clients.forEach(c => c.disconnect());
          done(err);
        });

        client.on('connect', () => {
          connectedCount++;
          client.on('multi_broadcast', (data) => {
            expect(data).toEqual(testPayload);
            checkDone();
          });

          if (connectedCount === 3) {
            if (socketModule && typeof socketModule.broadcast === 'function') {
              socketModule.broadcast('multi_broadcast', testPayload);
            } else if (ioServer) {
              ioServer.emit('multi_broadcast', testPayload);
            } else {
              clients.forEach(c => c.disconnect());
              done(new Error('Backend socket layer broadcast function not implemented yet'));
            }
          }
        });
      });
    });

    test('Test 3.3: Broadcast event payload integrity check (complex JSON payload with nested properties)', (done) => {
      const token = generateToken({ userId: 'payload_user' });
      const client = createClient({ auth: { token } });

      const complexPayload = {
        eventId: 'evt-998877',
        action: 'UPDATE_STATUS',
        metadata: {
          timestamp: 1774392000,
          nested: {
            deepKey: 'deepValue',
            numbers: [1, 2, 3, 4],
            booleanFlag: true
          }
        },
        items: [
          { id: 'item-1', name: 'Track 1', duration: 180 },
          { id: 'item-2', name: 'Track 2', duration: 240 }
        ]
      };

      client.on('connect', () => {
        client.on('complex_broadcast', (data) => {
          expect(data).toEqual(complexPayload);
          expect(data.metadata.nested.deepKey).toBe('deepValue');
          expect(data.items.length).toBe(2);
          client.disconnect();
          done();
        });

        if (socketModule && typeof socketModule.broadcast === 'function') {
          socketModule.broadcast('complex_broadcast', complexPayload);
        } else if (ioServer) {
          ioServer.emit('complex_broadcast', complexPayload);
        } else {
          client.disconnect();
          done(new Error('Backend socket layer broadcast function not implemented yet'));
        }
      });

      client.on('connect_error', (err) => {
        client.disconnect();
        done(err);
      });
    });
  });

  // Tier 4 — Real-World Application Scenarios
  describe('Tier 4: End-to-End Workflow Scenarios', () => {
    test('Test 4.1: Full workflow test — Start server, generate JWT token, connect client, trigger backend broadcast function, client logs event, disconnect client cleanly', (done) => {
      const token = generateToken({ userId: 'e2e_workflow_user' });
      const client = createClient({ auth: { token } });
      const workflowEvent = 'workflow_step';
      const workflowPayload = { step: 1, status: 'IN_PROGRESS' };

      client.on('connect', () => {
        expect(client.connected).toBe(true);
        expect(client.id).toBeDefined();

        client.on(workflowEvent, (data) => {
          expect(data).toEqual(workflowPayload);
          client.disconnect();
          expect(client.connected).toBe(false);
          done();
        });

        if (socketModule && typeof socketModule.broadcast === 'function') {
          socketModule.broadcast(workflowEvent, workflowPayload);
        } else if (ioServer) {
          ioServer.emit(workflowEvent, workflowPayload);
        } else {
          client.disconnect();
          done(new Error('Backend socket layer broadcast function not implemented yet'));
        }
      });

      client.on('connect_error', (err) => {
        client.disconnect();
        done(err);
      });
    });

    test('Test 4.2: Client reconnect scenario with token re-validation', (done) => {
      const initialToken = generateToken({ userId: 'reconnect_user', session: 1 });
      let client = createClient({ auth: { token: initialToken } });

      client.on('connect', () => {
        expect(client.connected).toBe(true);
        
        // Disconnect initial session
        client.disconnect();
        expect(client.connected).toBe(false);

        // Reconnect with new valid token
        const newToken = generateToken({ userId: 'reconnect_user', session: 2 });
        const reconnectedClient = createClient({ auth: { token: newToken } });

        reconnectedClient.on('connect', () => {
          expect(reconnectedClient.connected).toBe(true);
          expect(reconnectedClient.id).toBeDefined();
          reconnectedClient.disconnect();
          done();
        });

        reconnectedClient.on('connect_error', (err) => {
          reconnectedClient.disconnect();
          done(err);
        });
      });

      client.on('connect_error', (err) => {
        client.disconnect();
        done(err);
      });
    });
  });
});
