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
