/**
 * HTTP/3 (QUIC) & WebTransport Middleware
 * Injects Alt-Svc headers to signal HTTP/3 capability over UDP 443 to clients (browsers / Electron).
 */
function http3Middleware(req, res, next) {
  // Signal to Chromium / Electron runtime that HTTP/3 is available on UDP port 443
  // ma=86400 (max-age in seconds = 24 hours), persist=1 (keep capability across network changes)
  res.setHeader('Alt-Svc', 'h3=":443"; ma=86400; persist=1');
  
  // Expose Alt-Svc to CORS clients if CORS header inspection is performed
  const existingExpose = res.getHeader('Access-Control-Expose-Headers');
  if (existingExpose) {
    res.setHeader('Access-Control-Expose-Headers', `${existingExpose}, Alt-Svc`);
  } else {
    res.setHeader('Access-Control-Expose-Headers', 'Alt-Svc, Content-Range, Accept-Ranges, Content-Length');
  }

  next();
}

module.exports = http3Middleware;
