const http = require('http');

/**
 * Verification Test for HTTP/3 Alt-Svc Middleware & Headers
 */
async function testHttp3Headers() {
  console.log('=' .repeat(60));
  console.log('🚀 TESTING HTTP/3 (QUIC) & WEBTRANSPORT MIDDLEWARE');
  console.log('=' .repeat(60));

  const http3Middleware = require('../src/middleware/http3');

  // Mock Request & Response
  const req = { headers: {} };
  const headersSet = {};

  const res = {
    setHeader: (key, val) => {
      headersSet[key] = val;
    },
    getHeader: (key) => headersSet[key]
  };

  let nextCalled = false;
  http3Middleware(req, res, () => {
    nextCalled = true;
  });

  console.log('Checking Alt-Svc header injection...');
  if (headersSet['Alt-Svc'] && headersSet['Alt-Svc'].includes('h3=":443"')) {
    console.log(' ✅ PASS: Alt-Svc header set correctly:', headersSet['Alt-Svc']);
  } else {
    console.error(' ❌ FAIL: Alt-Svc header missing or incorrect:', headersSet['Alt-Svc']);
    process.exit(1);
  }

  console.log('Checking CORS Expose-Headers...');
  if (headersSet['Access-Control-Expose-Headers'] && headersSet['Access-Control-Expose-Headers'].includes('Alt-Svc')) {
    console.log(' ✅ PASS: Access-Control-Expose-Headers includes Alt-Svc:', headersSet['Access-Control-Expose-Headers']);
  } else {
    console.error(' ❌ FAIL: Access-Control-Expose-Headers missing Alt-Svc:', headersSet['Access-Control-Expose-Headers']);
    process.exit(1);
  }

  if (nextCalled) {
    console.log(' ✅ PASS: Middleware calls next() cleanly');
  } else {
    console.error(' ❌ FAIL: Middleware did not invoke next()');
    process.exit(1);
  }

  console.log('=' .repeat(60));
  console.log('🎉 ALL HTTP/3 ARCHITECTURE TESTS PASSED CLEANLY');
  console.log('=' .repeat(60));
}

testHttp3Headers().catch((err) => {
  console.error('Fatal error running HTTP/3 test:', err);
  process.exit(1);
});
