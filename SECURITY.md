# 🔐 Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `main` branch | ✅ |
| Older branches | ❌ |

---

## Vulnerability Disclosure History

> Last audit: **2026-07-19**  
> Methodology: White-box manual code review

| ID | Severity | Title | Status | Fixed in commit |
|---|---|---|---|---|
| [LNX-2026-001](#lnx-2026-001) | 🔴 CRITICAL (9.8) | Hardcoded APP_SECRET in source code | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-002](#lnx-2026-002) | 🔴 CRITICAL (9.1) | Hardcoded JWT_SECRET fallback | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-003](#lnx-2026-003) | 🔴 HIGH (8.1) | Unencrypted HTTP transport (no TLS) | ⚠️ Partial | Needs TLS cert on server |
| [LNX-2026-004](#lnx-2026-004) | 🟠 HIGH (7.5) | `/api/status` exposes internal infrastructure | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-005](#lnx-2026-005) | 🟠 HIGH (7.3) | No rate limit on `/auth/verify-code` (bruteforce) | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-006](#lnx-2026-006) | 🟠 HIGH (6.8) | JWT tokens without revocation capability | ⏳ Backlog | Needs refresh token flow |
| [LNX-2026-007](#lnx-2026-007) | 🟠 HIGH (6.5) | Telegram Bot Token exposed in avatar URL | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-008](#lnx-2026-008) | 🟡 MEDIUM (5.9) | CORS wildcard allows all origins | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-009](#lnx-2026-009) | 🟡 MEDIUM (5.4) | Unsanitized user input stored in DB | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-010](#lnx-2026-010) | 🟡 MEDIUM (4.3) | `/api/stats/top-tracks` unbounded limit | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-011](#lnx-2026-011) | 🟡 MEDIUM (4.2) | Missing `auth_date` check in Telegram Widget auth | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-012](#lnx-2026-012) | 🟢 LOW (3.7) | JWT stored in `localStorage` (XSS accessible) | ⏳ Backlog | Low risk in Electron |
| [LNX-2026-013](#lnx-2026-013) | 🔴 HIGH (8.5) | Open SSRF via `/api/sc/stream` fallback | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-014](#lnx-2026-014) | 🟠 HIGH (7.2) | NoSQL Injection via Object parameters in DELETE | ✅ Fixed | `security/cve-fixes` |
| [LNX-2026-015](#lnx-2026-015) | 🟡 MEDIUM (6.5) | Missing object bounds causing Denial of Service (DB Bloat) | ✅ Fixed | `security/cve-fixes` |

**Legend:** ✅ Fixed · ⚠️ Partial · ⏳ Backlog

---

## Detailed Findings

---

### LNX-2026-001
**Hardcoded APP_SECRET in Source Code**  
**CVSS: 9.8 (Critical)** · `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`

The `APP_SECRET` used for HMAC request signing was hardcoded as `'my-super-secret-desktop-key'` directly in both `electron/main.js` and `src/config/env.js`. Since both repositories are on GitHub, any reader could forge a valid `x-lunex-signature` header and bypass API authentication.

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
  /^lunex:\/\//,
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
- Sliced `x-lunex-platform` headers to a maximum of 50 characters to prevent metric database bloat.

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
