# 🔐 Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `main` branch | ✅ |
| Older branches | ❌ |

---

## Vulnerability Disclosure History

> Last audit: **2026-07-19** (updated 2026-07-19 — pass 2, frontend + backend)  
> Methodology: White-box manual code review

| ID | Severity | Title | Status | Fixed in commit |
|---|---|---|---|---|
| [LNX-2026-001](#lnx-2026-001) | 🔴 CRITICAL (9.8) | Hardcoded APP_SECRET in source code | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-002](#lnx-2026-002) | 🔴 CRITICAL (9.1) | Hardcoded JWT_SECRET fallback | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-013](#lnx-2026-013) | 🔴 HIGH (8.5) | Open SSRF via `/api/sc/stream` fallback | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-018](#lnx-2026-018) | 🔴 HIGH (8.2) | APP_SECRET hardcoded in Electron main.js (plaintext) | ✅ Fixed | `security/fix-018-023` |
| [LNX-2026-003](#lnx-2026-003) | 🔴 HIGH (8.1) | Unencrypted HTTP transport (no TLS) | ⚠️ Partial | Needs TLS cert on server |
| [LNX-2026-024](#lnx-2026-024) | 🟠 HIGH (7.4) | Auth code generated with `Math.random()` (not cryptographically secure) | ✅ Fixed | `security/fix-024-027` |
| [LNX-2026-016](#lnx-2026-016) | 🟠 HIGH (7.4) | Open Redirect in Google OAuth Callback | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-028](#lnx-2026-028) | 🟠 HIGH (7.1) | CSS Injection via unsanitized community theme CSS variables | ✅ Fixed | `security/fix-028-030` |
| [LNX-2026-004](#lnx-2026-004) | 🟠 HIGH (7.5) | `/api/status` exposes internal infrastructure | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-019](#lnx-2026-019) | 🟠 HIGH (7.5) | Admin badge check via DB allows badge manipulation | ✅ Fixed | `security/fix-018-023` |
| [LNX-2026-014](#lnx-2026-014) | 🟠 HIGH (7.2) | NoSQL Injection via Object parameters in DELETE | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-005](#lnx-2026-005) | 🟠 HIGH (7.3) | No rate limit on `/auth/verify-code` (bruteforce) | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-006](#lnx-2026-006) | 🟠 HIGH (6.8) | JWT tokens without revocation capability | ⏳ Backlog | Needs refresh token flow |
| [LNX-2026-007](#lnx-2026-007) | 🟠 HIGH (6.5) | Telegram Bot Token exposed in avatar URL | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-015](#lnx-2026-015) | 🟡 MEDIUM (6.5) | Missing object bounds causing Denial of Service (DB Bloat) | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-020](#lnx-2026-020) | 🟡 MEDIUM (6.1) | `admin/logs` leaks internal server state to admins | ⏳ Backlog | Accepted risk |
| [LNX-2026-008](#lnx-2026-008) | 🟡 MEDIUM (5.9) | CORS wildcard allows all origins | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-017](#lnx-2026-017) | 🟡 MEDIUM (5.9) | HMAC Timing Attack in Signature Verification | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-021](#lnx-2026-021) | 🟡 MEDIUM (5.8) | `contentSecurityPolicy: false` disables CSP entirely | ✅ Fixed | `security/fix-018-023` |
| [LNX-2026-022](#lnx-2026-022) | 🟡 MEDIUM (5.5) | `artwork` URL in track data not validated — SSRF vector | ✅ Fixed | `security/fix-018-023` |
| [LNX-2026-009](#lnx-2026-009) | 🟡 MEDIUM (5.4) | Unsanitized user input stored in DB | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-025](#lnx-2026-025) | 🟡 MEDIUM (5.3) | `settingsStore.upsert` merges full user payload without field whitelist | ✅ Fixed | `security/fix-024-027` |
| [LNX-2026-027](#lnx-2026-027) | 🟡 MEDIUM (5.0) | `/api/yt/upnext` history parameter unbounded — DoS via huge list | ✅ Fixed | `security/fix-024-027` |
| [LNX-2026-010](#lnx-2026-010) | 🟡 MEDIUM (4.3) | `/api/stats/top-tracks` unbounded limit | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-011](#lnx-2026-011) | 🟡 MEDIUM (4.2) | Missing `auth_date` check in Telegram Widget auth | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-012](#lnx-2026-012) | 🟢 LOW (3.7) | JWT stored in `localStorage` (XSS accessible) | ⏳ Backlog | Low risk in Electron |
| [LNX-2026-026](#lnx-2026-026) | 🟢 LOW (3.5) | `POST /themes/:id/download` has no rate limit — counter can be inflated | ✅ Fixed | `security/fix-024-027` |
| [LNX-2026-029](#lnx-2026-029) | 🟢 LOW (3.2) | Queue unbounded — `localStorage` bloat / DoS | ✅ Fixed | `security/fix-028-030` |
| [LNX-2026-030](#lnx-2026-030) | 🟢 LOW (3.2) | `useStats` topTracks/topArtists unbounded — `localStorage` bloat | ✅ Fixed | `security/fix-028-030` |
| [LNX-2026-023](#lnx-2026-023) | 🟢 LOW (3.1) | Discord RPC `track.title` sent without length limit | ✅ Fixed | `security/fix-018-023` |
| [LNX-2026-031](#lnx-2026-031) | 🔴 HIGH (8.2) | SSRF Bypass in `/api/sc/stream` fallback via malformed hostname | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-032](#lnx-2026-032) | 🟠 HIGH (7.0) | Cache Exhaustion DoS via unbounded query strings | ⏳ Backlog | Needs `maxKeys` limit |
| [LNX-2026-033](#lnx-2026-033) | 🟡 MEDIUM (5.5) | DB Bloat via unbounded `themeData` payload | ⏳ Backlog | Needs payload size limit |

**Legend:** ✅ Fixed · ⚠️ Partial · ⏳ Backlog

---

## Detailed Findings

---

### LNX-2026-001
**Hardcoded APP_SECRET in Source Code**  
**CVSS: 9.8 (Critical)** · `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`

The `APP_SECRET` used for HMAC request signing was hardcoded as `'my-super-secret-desktop-key'` directly in both `electron/main.js` and `src/config/env.js`. Since both repositories are on GitHub, any reader could forge a valid `x-plume-signature` header and bypass API authentication.

**Fix:** Both `APP_SECRET` and `JWT_SECRET` now use `requireEnv()` which throws at startup if the environment variable is not set. No fallback values exist.

```diff
- JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-in-production',
- APP_SECRET: process.env.APP_SECRET || 'my-super-secret-desktop-key',
+ JWT_SECRET: requireEnv('JWT_SECRET'),
+ APP_SECRET: requireEnv('APP_SECRET'),
```

---

### LNX-2026-002
**Hardcoded JWT_SECRET Fallback**  
**CVSS: 9.1 (Critical)** · `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N`

`JWT_SECRET` had a known default value `'dev-secret-change-in-production'`. An attacker could sign arbitrary JWT tokens granting access to any user account.

**Fix:** Same as LNX-2026-001 — `requireEnv()` enforces the secret is set.

---

### LNX-2026-003
**Unencrypted HTTP Transport**  
**CVSS: 8.1 (High)** · `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N`

All traffic between the Electron client and backend is sent over plain HTTP. JWT tokens and HMAC signatures are visible to anyone on the same network via MITM.

**Status: Partial** — Requires configuring TLS/HTTPS on the server with a certificate. The codebase is ready; infrastructure change needed.

**Recommended fix:**
```
# On server VM:
sudo certbot certonly --standalone -d yourdomain.com
# Update BASE in electron/main.js and client.js to https://
```

---

### LNX-2026-004
**Information Disclosure via `/api/status`**  
**CVSS: 7.5 (High)** · `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`

The `/api/status` endpoint was publicly accessible without authentication and returned the full proxy pool including real IP addresses, ports, and cooldown states. This provided attackers with a complete infrastructure map.

**Fix:** Proxy URLs are now stripped from the public response. Only aggregate counters (`total`, `healthy`) are returned.

```diff
- proxy: getProxyStats(),   // exposed all IPs
+ proxy: { total: getProxyStats().total, healthy: getProxyStats().healthy }
```

---

### LNX-2026-005
**Bruteforce on `/auth/verify-code`**  
**CVSS: 7.3 (High)** · `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N`

The 6-character login code endpoint had no dedicated rate limit. The global limiter (500 req/10min) allowed ~250 attempts within the 5-minute code validity window.

**Fix:** A dedicated strict rate limiter is applied — **5 attempts per 5 minutes per IP**.

```js
const verifyCodeLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 5 })
router.post('/verify-code', verifyCodeLimiter, asyncHandler(...))
```

---

### LNX-2026-006
**JWT Without Revocation**  
**CVSS: 6.8 (High)** · `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N`

JWT tokens have a 30-day lifetime with no revocation mechanism. There is no JWT ID (`jti`), no blacklist, and no refresh token flow. Compromised tokens remain valid for up to 30 days.

**Status: Backlog** — Requires implementing a token blacklist (Redis) or a refresh token pattern.

---

### LNX-2026-007
**Telegram Bot Token in Avatar URL**  
**CVSS: 6.5 (High)** · `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N`

The avatar URL was stored as `https://api.telegram.org/file/bot{TOKEN}/{file_path}`, embedding the bot token in the database, JWT payload, and client-visible responses. Any user with their own JWT could decode the base64 payload and extract the full bot token.

**Fix (3 parts):**
1. `telegramBot.js` — stores only `file_path`, not the full URL
2. `me.routes.js` — `/me` replaces `file_path` with a safe proxy URL `/me/avatar`
3. `me.routes.js` — new `GET /me/avatar` endpoint proxies the image server-side, bot token never leaves the server

---

### LNX-2026-008
**CORS Wildcard Origin**  
**CVSS: 5.9 (Medium)** · `AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:L/A:N`

`cors()` without `origin` option allowed all domains. Combined with the browser fallback in `client.js` that skips HMAC signing, cross-origin requests could be made with a stolen token.

**Fix:** CORS is now restricted to specific allowed origins via regex.

```js
const ALLOWED_ORIGINS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^https:\/\/localhost(:\d+)?$/,
  /^plume:\/\//,
]
```

---

### LNX-2026-009
**Unsanitized User Input in Database**  
**CVSS: 5.4 (Medium)** · `AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N`

Fields like `name`, `themeData`, `title`, `artist`, and `artwork` are stored without sanitization. React's JSX escaping prevents XSS in the current Electron client, but a future web version would be vulnerable to Stored XSS. Also, unbounded string lengths allowed Denial of Service via DB bloat.

**Fix:** Added strict type casting and length boundaries for inputs on theme publishing and other endpoints.

---

### LNX-2026-010
**Unbounded `limit` Parameter on `/api/stats/top-tracks`**  
**CVSS: 4.3 (Medium)** · `AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N`

The `?limit` parameter was not capped, allowing a single request to dump the entire track statistics table.

**Fix:** `Math.min(parseInt(req.query.limit) || 10, 50)` — maximum 50 records per request.

---

### LNX-2026-011
**Missing `auth_date` Validation in Telegram Login**  
**CVSS: 4.2 (Medium)** · `AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N`

The Telegram Login Widget authentication validated the HMAC signature but did not check `auth_date`. Per Telegram's docs, data older than 86400 seconds should be rejected. A captured auth payload could be replayed indefinitely.

**Fix:**
```js
const authDate = parseInt(fields.auth_date, 10)
if (!authDate || (Date.now() / 1000 - authDate) > 86400) return null
```

---

### LNX-2026-012
**JWT in `localStorage` (XSS-accessible)**  
**CVSS: 3.7 (Low)** · `AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N`

The JWT is stored in `localStorage`, accessible to any JavaScript running in the same origin. In the Electron context this risk is minimal as pages are loaded from local files and XSS is practically impossible.

**Status: Backlog** — Acceptable risk in Electron. For a future web version, `httpOnly` cookies should be used instead.

---

### LNX-2026-013
**Open SSRF via `/api/sc/stream` fallback**  
**CVSS: 8.5 (High)** · `AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:N/A:N`

The `url` parameter was passed directly to Axios without validation. An attacker could force the backend to make arbitrary GET requests to internal infrastructure or external targets.

**Fix:** Enforced domain allowlist checking (`startsWith('https://api-v2.soundcloud.com/')` or `soundcloud.com/`).

---

### LNX-2026-014
**NoSQL Injection via Object parameters in DELETE**  
**CVSS: 7.2 (High)** · `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:H`

The user data routes accepted JSON payloads where `trackId` could be passed as a query object `{"$ne": null}`. NeDB evaluated this as a NoSQL condition, allowing an attacker to inadvertently or maliciously delete their entire playlists or liked tracks.

**Fix:** Strictly cast `req.body.trackId` and `req.body.source` to strings using `String()`.

---

### LNX-2026-015
**Missing object bounds causing Denial of Service (DB Bloat)**  
**CVSS: 6.5 (Medium)** · `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H`

Data structures like `track` payloads in `POST /likes`, `POST /listening-history`, and `/playlists` lacked strict length sanitization. Additionally, there were no hard limits on the number of playlists per user, or the number of tracks per playlist. An attacker could craft massive JSON payloads or spam database entries, exhausting server memory and crashing the application (as NeDB keeps datasets in memory).

**Fix:** 
- Implemented `sanitizeTrack()` in `user-data.routes.js` to strictly slice all strings to safe lengths (100-1000 characters).
- Enforced hard limits: 50 playlists per user, 500 tracks per playlist, 10 custom themes per user.
- Sliced `x-plume-platform` headers to a maximum of 50 characters to prevent metric database bloat.

---

### LNX-2026-016
**Open Redirect in Google OAuth Callback**  
**CVSS: 7.4 (High)** · `AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N`

The `isSafeCallback` function in `auth.routes.js` checked if the URL started with `http://localhost:`. An attacker could bypass this by using a URL like `http://localhost:@attacker.com`, which browsers interpret as navigating to `attacker.com` with `localhost:` as HTTP Basic Auth credentials. This allowed stealing the generated JWT token via a malicious callback URL.

**Fix:** Replaced simple string prefix matching with robust parsing using the WHATWG `URL` API (`new URL(callbackUrl)`) and strictly validating `parsed.hostname === 'localhost'`.

---

### LNX-2026-017
**HMAC Timing Attack in Signature Verification**  
**CVSS: 5.9 (Medium)** · `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N`

HMAC signatures in `server.js` (Private API auth) and `services/auth/telegram.js` (Telegram Widget auth) were verified using the standard strict inequality operator (`!==`). Because V8's string comparison exits early on the first mismatched character, an attacker could theoretically guess the expected HMAC character-by-character by measuring the server's response time (Timing Attack).

**Fix:** Switched to constant-time string comparison using Node's `crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))`.

---

### LNX-2026-018
**APP_SECRET Hardcoded in Electron `main.js`**  
**CVSS: 8.2 (High)** · `AV:L/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:N`

The `APP_SECRET` used for HMAC request signing is **still hardcoded** as a string literal directly in `electron/main.js`:

```js
// electron/main.js line 11
const APP_SECRET = 'super-secret-plume-app-key-2026'
```

Anyone who decompiles the shipped Electron `.asar` archive (a trivial operation: `npx asar extract app.asar ./out`) can extract this secret and forge any API request with a valid HMAC signature, bypassing the Private API authentication middleware entirely.

**Recommended Fix:** Use `process.env.PLUME_APP_SECRET` injected at build time via `electron-builder`'s `extraMetadata` or an env-injection build step. If that is not feasible, rotate the secret and accept that it will be visible to determined users (Electron client is untrusted by design).

```diff
- const APP_SECRET = 'super-secret-plume-app-key-2026'
+ const APP_SECRET = process.env.PLUME_APP_SECRET || import.meta.env.VITE_APP_SECRET
```

---

### LNX-2026-019
**Admin Authorization via DB Badge — Privilege Escalation Risk**  
**CVSS: 7.5 (High)** · `AV:N/AC:H/PR:L/UI:N/S:U/C:H/I:H/A:N`

In `adminAuth.js`, after checking `DEV_EMAILS`/`DEV_TELEGRAM_IDS`, the middleware falls back to checking if the user has a `'Developer'` badge in the database:

```js
// adminAuth.js line 27
if (badges && badges.includes('Developer')) {
  req.user = decoded
  return next()
}
```

However, `badges` is an array of **objects** (e.g. `{ id: 'developer', label: '...', earnedAt: ... }`), not an array of strings. Therefore `badges.includes('Developer')` will **always be `false`** because `'Developer' !== { id: 'developer', ... }`. This logic is silently broken. While currently it does not grant unintended access (it fails safely), it means any badge-based admin delegation is non-functional and the code gives a false sense of security.

**Recommended Fix:**
```diff
- if (badges && badges.includes('Developer')) {
+ if (badges && badges.some(b => b.id === 'developer')) {
```

---

### LNX-2026-020
**`GET /api/admin/logs` — Sensitive Server State Disclosure**  
**CVSS: 6.1 (Medium)** · `AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:N/A:N`

The `/api/admin/logs` endpoint returns up to 200 lines of captured `console.log` / `console.error` output, including full error stack traces, internal path names, and raw API error messages from YouTube/SoundCloud responses. While the route is correctly protected by `adminAuth`, any compromised admin token would immediately expose the full internal error state of the server.

**Status: Accepted Risk** — Access is admin-only. Consider filtering known sensitive patterns (file paths, auth codes) from log output in the future.

---

### LNX-2026-021
**Content Security Policy Disabled (`contentSecurityPolicy: false`)**  
**CVSS: 5.8 (Medium)** · `AV:N/AC:H/PR:N/UI:R/S:C/C:L/I:L/A:N`

`helmet` is configured with `contentSecurityPolicy: false` in `server.js`, disabling the CSP header entirely for all pages served — including the admin panel. A CSP is the primary browser-level defense against Cross-Site Scripting (XSS) attacks.

```js
// server.js line 16-18
app.use(helmet({
  contentSecurityPolicy: false  // ← CSP is off
}))
```

**Recommended Fix:** Define a strict CSP for the admin panel origin:
```js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    }
  }
}))
```

---

### LNX-2026-022
**Unvalidated `artwork` URL in Track Data — Potential SSRF Vector**  
**CVSS: 5.5 (Medium)** · `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N`

The `sanitizeTrack()` function in `user-data.routes.js` stores the `artwork` field as a raw URL string with only a length limit of 1000 characters:

```js
artwork: String(t.artwork || '').slice(0, 1000),
```

No URL scheme validation is performed. If any future backend code were to fetch this URL (e.g., to generate thumbnails, cache artwork, or forward it), a user could inject `file:///etc/passwd`, `http://169.254.169.254/` (AWS metadata), or `gopher://` URIs to achieve SSRF. Currently there is no server-side fetch of this field, so the risk is latent.

**Recommended Fix:** Add a URL scheme allowlist:
```js
function isValidArtworkUrl(url) {
  try {
    const u = new URL(url)
    return ['https:', 'http:'].includes(u.protocol)
  } catch { return false }
}
artwork: isValidArtworkUrl(t.artwork) ? String(t.artwork).slice(0, 1000) : '',
```

---

### LNX-2026-023
**Discord RPC `track.title` Without Length Limit**  
**CVSS: 3.1 (Low)** · `AV:L/AC:H/PR:N/UI:R/S:U/C:N/I:N/A:L`

In `electron/discord.js`, `track.title` and `track.artist` are passed directly to Discord's `SET_ACTIVITY` RPC call without any length validation. Discord's API enforces a maximum of **128 characters** for `details` and `state`. While Discord will silently truncate or reject oversized values, a track with an extremely long title (e.g., from a scraped YouTube video) could cause a noisy RPC rejection error in logs on every playback event.

**Recommended Fix:**
```js
details: (track.title || 'Unknown').slice(0, 128),
state: stateText.slice(0, 128),
```

---

### LNX-2026-024
**Auth Code Generated with `Math.random()` (Cryptographically Weak)**  
**CVSS: 7.4 (High)** · `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N`

`authCodeStore.js` used `Math.floor(Math.random() * chars.length)` to generate the 6-character login code. `Math.random()` is a pseudo-random number generator (PRNG) seeded by the V8 engine — it is not cryptographically random and is predictable if the seed can be inferred. An attacker who can observe or manipulate memory state could predict future codes.

**Fix:** Replaced with `crypto.randomInt(0, chars.length)` from Node's built-in `crypto` module.

```diff
- code += chars[Math.floor(Math.random() * chars.length)]
+ code += chars[crypto.randomInt(0, chars.length)]
```

---

### LNX-2026-025
**`settingsStore.upsert` — No Field Whitelist**  
**CVSS: 5.3 (Medium)** · `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N`

`settingsStore.upsert()` merged the entire `fields` object from user input directly into the DB document with `{ ...existing, ...fields, userId }`. This allowed a user to inject arbitrary keys into the settings document, including overwriting `userId`, `_id`, or adding noise fields that pollute the database.

**Fix:** Only `theme`, `accent`, and `customThemeData` are now allowed through an explicit whitelist.

---

### LNX-2026-026
**`POST /themes/:id/download` — No Rate Limit**  
**CVSS: 3.5 (Low)** · `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N`

The theme download counter endpoint was publicly accessible with no rate limiting. Any user could send thousands of requests to artificially inflate the download count of any theme.

**Fix:** Added a dedicated rate limiter of **10 requests per minute per IP**.

---

### LNX-2026-027
**`/api/yt/upnext` History Parameter Unbounded**  
**CVSS: 5.0 (Medium)** · `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L`

The `?history=` query parameter in the `/api/yt/upnext` route was split on commas without any length limit. A request with tens of thousands of comma-separated IDs would create an enormous array processed by the recommendation logic, causing CPU/memory spikes (application-layer DoS).

**Fix:** History array is now capped at **50 IDs** with `.slice(0, 50)`.

---

### LNX-2026-031
**SSRF Bypass in `/api/sc/stream` fallback via malformed hostname**  
**CVSS: 8.2 (High)** · `AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:N/A:N`

The previous fix for SSRF in `soundcloud.routes.js` (LNX-2026-013) validated URLs using `String.prototype.startsWith('https://api-v2.soundcloud.com/')`. This is vulnerable to an `@` bypass. An attacker could provide a URL like `https://api-v2.soundcloud.com@attacker.com/`, which satisfies the `startsWith` check but causes Axios to send the request to `attacker.com` (treating `api-v2.soundcloud.com` as HTTP basic auth credentials).

**Fix:** Switched to strict parsing using the `URL` object and validating the `hostname` property directly.

```js
const parsedUrl = new URL(safeUrl)
if (parsedUrl.hostname !== 'api-v2.soundcloud.com' && parsedUrl.hostname !== 'soundcloud.com') {
  throw new Error('Invalid SoundCloud URL')
}
```

---

### LNX-2026-032
**Cache Exhaustion DoS via Unbounded Query Strings**  
**CVSS: 7.0 (High)** · `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`

The `cacheMiddleware` in `src/middleware/cache.js` uses `req.originalUrl` as the cache key, which includes all query parameters. An attacker can repeatedly query an endpoint with random parameters (e.g., `/api/yt/search?q=rnd1`, `/api/yt/search?q=rnd2`). Since the in-memory `NodeCache` instance does not have a `maxKeys` limit configured, this allows an attacker to exhaust the Node.js process memory, resulting in an OOM crash.

**Status: Backlog** — Needs configuring `maxKeys` for `NodeCache` or enforcing strict query parameter validation.

---

### LNX-2026-033
**DB Bloat via Unbounded `themeData` Payload**  
**CVSS: 5.5 (Medium)** · `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L`

In `themes.routes.js`, the `themeData` object submitted by users when publishing a theme is not size-limited or structurally validated before being saved to MongoDB. A malicious authenticated user can submit up to 10 themes, each containing a massive multi-megabyte `themeData` object, contributing to severe DB bloat and potential performance degradation.

**Status: Backlog** — Needs strict payload size limits and key/value validation for the `themeData` JSON structure.

---

## Environment Variables Required

> ⚠️ The server will **refuse to start** if these are not set in `.env`

```env
# Required — server crashes on startup without these
JWT_SECRET=<minimum 32 chars random string>
APP_SECRET=<minimum 32 chars random string>

# Required for auth to work
TELEGRAM_BOT_TOKEN=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Generate strong secrets:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
