# Original User Request

## Initial Request — 2026-07-24T19:38:35Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview

Implement a real-time WebSocket layer for the Node.js backend using Socket.io. This will allow clients to receive live updates without polling.

Working directory: F:\Projects\Lunex\lunex-backendv2
Integrity mode: development

## Requirements

### R1. Setup Socket.io
Attach a Socket.io server to the existing Express HTTP server. Ensure CORS is configured to allow connections from any origin (or the configured frontend origin).

### R2. WebSocket Authentication
Implement middleware for Socket.io to authenticate connections using the existing JWT authentication logic (the same secret used for HTTP requests). Reject unauthenticated connections.

### R3. Broadcasting Setup
Provide a simple module or function that can be imported anywhere in the backend to broadcast real-time events (e.g., `user_online`, `now_playing`) to all authenticated clients.

## Acceptance Criteria

### Connection & Auth
- [ ] A test script can successfully connect to the Socket.io server using a valid JWT token.
- [ ] A test script connecting without a token or with an invalid token is rejected by the server.

### Broadcasting
- [ ] When the backend broadcasts an event via the new module, the connected test client receives it and logs it to the console.

---
*Next: when approved → delegate via invoke_subagent (see Delegation Protocol)*

## 2026-07-26T14:23:18Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview

Implement comprehensive defensive programming measures across the backend. This includes global/route-specific rate limiting, strict payload validation, and database query sanitization.

Working directory: F:\Projects\Lunex\lunex-backendv2
Integrity mode: development

## Requirements

### R1. Rate Limiting (DDoS & Brute-force protection)
Install and configure `express-rate-limit`. Apply a global limit (e.g., 100 requests per 15 minutes) to all routes. Apply strict limits (e.g., 5 requests per 15 minutes) to sensitive endpoints like login and registration.

### R2. Input Validation (Joi/Zod)
Implement schema-based payload validation (e.g., using `joi` or `zod`) for all `POST` and `PUT` endpoints. Ensure that unexpected fields are stripped or rejected (preventing mass assignment and injection).

### R3. NoSQL Injection Prevention
Audit all MongoDB queries (using `mongodb` driver) in the codebase. Ensure all user inputs are properly sanitized or cast to expected types (e.g., ensuring an ID is a string/ObjectId, not a query object like `$gt`) before passing them to database methods.

## Acceptance Criteria

### Rate Limiting
- [ ] A test script attempting to hit the `/auth/login` endpoint 10 times in 1 second receives a `429 Too Many Requests` status after the 5th request.

### Input Validation
- [ ] A test script sending a malformed payload or extra unauthorized fields (e.g., `isAdmin: true`) to a protected route receives a `400 Bad Request` status.

### DB Operations
- [ ] Core business flows (login, fetching data) continue to function normally. Existing tests (or a manual check) confirm no regressions.

---
*Next: when approved → delegate via invoke_subagent (see Delegation Protocol)*
