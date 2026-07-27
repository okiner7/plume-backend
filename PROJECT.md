# Project: Proxy Latency Optimization

## Architecture
- `proxyManager.js`: Core proxy management module responsible for storing proxy pools, agent creation, health status, and proxy selection logic (`getCountryAwareAgent`).
- Target services: SoundCloud and YouTube stream fetching.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Exploration & Architecture Analysis | Locate proxy files, analyze `proxyManager.js` structure, proxy objects, cooldown logic, and ping target APIs | none | DONE |
| 2 | Background Ping & Smart Selection Implementation | Implement background ping loop in `proxyManager.js` (R1) & update `getCountryAwareAgent` for smart latency-based selection (R2) | M1 | DONE |
| 3 | Verification & Benchmarking | Execute 10 sequential stream requests via `test_proxy_latency.js`, verify <800ms average latency, run Forensic Audit | M2 | IN_PROGRESS |

## Interface Contracts
### `proxyManager.js`
- `getCountryAwareAgent(service, country, options)`: Returns HTTP agent for proxy with lowest recorded latency among non-cooldown active proxies.
- Background ping task: runs periodically (e.g. every 15-30s), pings SoundCloud/YouTube endpoints through active proxies, updates `proxy.latency` or `proxy.latencyMap`.

## Code Layout
- Proxy management: `src/utils/proxyManager.js` or `proxyManager.js` (to be confirmed by Explorer)
- Test script: `test_proxy_latency.js`
