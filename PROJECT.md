# Project: lunex-backendv2 - Plume Admin Panel SSE Real-Time Push Integration

## Architecture
- **Backend Stream Endpoint**: `GET /api/admin/stream` returning `Content-Type: text/event-stream`. Admin authenticated.
- **Broadcaster Hub**: Reuses `admin:metrics`, `admin:logs`, `apiTracker` middleware, online users tracker.
- **Frontend Admin Panel (`/public`)**: Replaces `setInterval` polling with `EventSource` connection. Auto-reconnection support.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|--------------|--------|
| 1 | Backend SSE Endpoint & Event Broadcaster | `GET /api/admin/stream`, heartbeat 15s, metrics 5s, real-time `api_hit` broadcast | None | DONE |
| 2 | Frontend Plume Admin SSE Migration | Replace polling loops in `/public` admin panel, setup `EventSource` auto-reconnect, reactive UI update | M1 | DONE |
| 3 | E2E Testing & Verification | E2E integration test, unit test suite verification, reviewer, challenger, forensic integrity check | M1, M2 | DONE |

## Code Layout
- `src/` - Node.js Backend source files (routes, middleware, controllers, services)
- `public/` - Plume Admin Panel static HTML/JS frontend assets
- `tests/` - Backend and integration test suites
