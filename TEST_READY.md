# Lunex Backend E2E Test Suite Infrastructure (TEST_READY)

## Overview
This document specifies the opaque-box, requirement-driven End-to-End (E2E) testing framework and suite established for the Lunex Backend (`lunex-backendv2`). The E2E test suite covers Global & Strict Rate Limiting (R1), Schema-based Payload Validation (R2), NoSQL Query Injection Prevention (R3), and Core Business Regression flows.

## Environment & Installed Dependencies
- **Test Runner**: Jest (`jest@^30.4.2`)
- **HTTP Assertion Library**: Supertest (`supertest@^7.2.2`)
- **Schema Validation Library**: Zod (`zod@^3.25.76`) installed via npm
- **Test Setup Script**: `tests/setup.js` (Handles MongoDB & Redis connection lifecycle)

---

## E2E Test Files & Tier Breakdown

The test suite is organized into requirement-focused test files under `tests/e2e/`:

### 1. Rate Limiting Suite (`tests/e2e/rate-limit.test.js`) — Requirement R1
- **Tier 1 (Feature Coverage)**: Requests 1-5 to sensitive authentication endpoints (`/auth/telegram`, `/auth/verify-code`) and general endpoints pass within limits without HTTP 429.
- **Tier 2 (Boundary Enforcement)**: 6th request to sensitive auth endpoints is rejected with HTTP 429 Too Many Requests; 101st request per 15 min to general API endpoints returns HTTP 429.
- **Tier 3 (IP Isolation & Structure)**: Verifies that exceeding rate limits on IP_A does not impact requests from IP_B; verifies 429 JSON response structure.
- **Tier 4 (Header & Reset Compliance)**: Validates presence of standard rate limit headers (`RateLimit-Limit`, `RateLimit-Remaining`) and retry timing headers (`Retry-After` / `RateLimit-Reset`).

### 2. Payload Validation Suite (`tests/e2e/input-validation.test.js`) — Requirement R2
- **Tier 1 (Feature Coverage)**: Valid POST and PUT payloads across `/auth/telegram`, `/me/playlists`, `/me/settings` are accepted without HTTP 400.
- **Tier 2 (Unexpected Fields Rejection)**: Payloads containing unknown, unexpected, or privilege-escalation fields (e.g. `{ isAdmin: true }`, `{ role: "admin" }`) are strictly rejected with HTTP 400 Bad Request.
- **Tier 3 (Missing Field Rejection)**: Payloads missing mandatory schema properties (e.g. `{ code }` in `/auth/verify-code`, `{ trackId }` in `/me/likes`) are rejected with HTTP 400 Bad Request.
- **Tier 4 (Invalid Type Rejection)**: Fields with incorrect data types (e.g. numeric playlist name `{ name: 12345 }` or object trackId `{ trackId: { id: 1 } }`) are rejected with HTTP 400 Bad Request.

### 3. NoSQL Injection Prevention Suite (`tests/e2e/nosql-injection.test.js`) — Requirement R3
- **Tier 1 (Feature Coverage)**: Normal string query parameters, POST body fields, and route parameters execute cleanly without errors.
- **Tier 2 (Operator Injection Handling)**: Payloads or queries containing MongoDB query operators (e.g. `{ "$ne": null }`, `{ "$gt": "" }`, `{ "$where": "..." }`) are sanitized or rejected with HTTP 400 without server crashes or 500 errors.
- **Tier 3 (Object Key Sanitization)**: Fields containing `$` prefixes or dot-notation keys (e.g. `"color.primary"`) are sanitized safely before query execution.
- **Tier 4 (Route & DB Safety)**: Ensures URL-encoded MongoDB operators in route parameters (e.g. `/me/playlists/%7B%22%24gt%22%3A%22%22%7D`) return safe non-500 HTTP responses.

### 4. Core Business Flows Regression Suite (`tests/e2e/regression.test.js`) — System Health
- **Tier 1 (Auth & Status Checks)**: Validates root GET `/`, GET `/auth/verify` token verification, and unauthenticated token rejection.
- **Tier 2 (User Settings & Preferences)**: Validates retrieving and updating user settings (`/me/settings`) and fetching user likes (`/me/likes`).
- **Tier 3 (User Playlists Flow)**: Validates creation (`POST /me/playlists`) and retrieval (`GET /me/playlists`) of user playlists.
- **Tier 4 (Admin Security & API Signatures)**: Validates admin health stats (`GET /api/status`) and rejection of missing signature headers (`403 Access Denied`).

---

## Test Execution Instructions

### Running All Tests
To execute the complete test runner across unit, integration, and E2E suites:
```bash
npm test
```

### Running E2E Test Suite Only
To run only the E2E test files under `tests/e2e/`:
```bash
npx jest tests/e2e
```

### Running Specific E2E Test Files
```bash
# Rate limiting tests
npx jest tests/e2e/rate-limit.test.js

# Input validation tests
npx jest tests/e2e/input-validation.test.js

# NoSQL injection prevention tests
npx jest tests/e2e/nosql-injection.test.js

# Core regression tests
npx jest tests/e2e/regression.test.js
```

---

## Summary Table

| Test File | Target Requirement | Total Tests | Status |
|-----------|--------------------|:-----------:|:------:|
| `tests/e2e/rate-limit.test.js` | R1 (Rate Limiting) | 10 | Created |
| `tests/e2e/input-validation.test.js` | R2 (Payload Validation) | 10 | Created |
| `tests/e2e/nosql-injection.test.js` | R3 (NoSQL Injection) | 10 | Created |
| `tests/e2e/regression.test.js` | System Regression & Auth | 10 | Created & Passing |
| **Total** | **E2E Infrastructure Target** | **40** | **Ready for M2-M5 Implementation** |
