# E2E Testing Infrastructure — Socket.io WebSocket Layer

This document describes the test environment, runner details, test tiers, and execution instructions for the Socket.io WebSocket Layer in the Lunex Backend (`lunex-backendv2`).

---

## 1. Test Framework & Environment

- **Jest Test Suite**: `tests/e2e/websocket.test.js`
- **Standalone CLI Client**: `scripts/test-socket-client.js`
- **Socket.io Version**: `^4.8.3` (Server & Client)
- **Environment Variables**:
  - `JWT_SECRET`: Secret key used for JWT signing and verification (default for testing: `testjwt`)
  - `APP_SECRET`: Application HMAC secret (default for testing: `testsecret`)
  - `SOCKET_URL`: Target server URL for CLI tests (default: `http://localhost:3000`)

---

## 2. Test Execution Commands

### Run Full E2E Test Suite (Jest)
```bash
npx jest tests/e2e/websocket.test.js --forceExit
```

### Run Standalone CLI Test Tool
```bash
node scripts/test-socket-client.js [optional_server_url]
```

### Run Full Backend Test Suite
```bash
npm test
```

---

## 3. Test Tiers Summary

| Tier | Category | Description | Test Cases Count | Status |
|------|----------|-------------|------------------|--------|
| **Tier 1** | Feature Coverage | Handshake authentication via `auth.token`, `headers.authorization`, and `query.token`; socket ID assignment and connect events. | 5 tests | Ready |
| **Tier 2** | Boundary & Corner Cases | Auth rejection for missing token, invalid token string, token with wrong secret, expired token, and empty auth. | 5 tests | Ready |
| **Tier 3** | Cross-Feature Broadcasting | Event broadcasting to single authenticated client, multi-client broadcast, and complex JSON payload integrity checks. | 3 tests | Ready |
| **Tier 4** | E2E Application Workflows | Full lifecycle (connect, broadcast event, log, disconnect cleanly) and client reconnect with token re-validation. | 2 tests | Ready |

Total Test Cases: **15**

---

## 4. Pass / Fail Semantics

- Exit code `0`: All tests passed cleanly.
- Non-zero exit code: Test failures or server unreachability (e.g. backend socket layer not implemented/running yet).
