// Polyfill Web Crypto API for Node.js v18
// MongoDB driver (v7+) uses globalThis.crypto.getRandomValues() which is only
// available as a global in Node.js v19+. This must run before any test code.
if (!globalThis.crypto) {
  globalThis.crypto = require('crypto').webcrypto
}
