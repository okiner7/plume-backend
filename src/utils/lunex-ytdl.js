const { ProxyAgent, fetch } = require('undici');
const vm = require('vm');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

chromium.use(stealth);

const DEFAULT_PROXY = process.env.YTDL_DEFAULT_PROXY || '';
const PLAYER_JS_URL = 'https://www.youtube.com/s/player/b81a9a58/player_es6.vflset/ru_RU/base.js';

const proxyAgentCache = new Map();
let globalBrowser = null;
let cachedPlayerJs = null;
let cachedDecipherCode = null;
let cachedVisitorData = null;

/**
 * Pre-fetches & caches YouTube visitorData token in memory.
 */
async function getVisitorData(dispatcher) {
    if (cachedVisitorData) return cachedVisitorData;

    // 1. Direct fetch from sw.js (fastest and most reliable)
    try {
        const res = await fetch('https://www.youtube.com/sw.js', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            dispatcher: undefined,
            signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
            const text = await res.text();
            const match = text.match(/visitorData['"]:\s*['"]([^'"]+)['"]/);
            if (match) {
                cachedVisitorData = match[1];
                return cachedVisitorData;
            }
        }
    } catch (e) {}

    // 2. Fallback fetch via dispatcher if provided
    if (dispatcher) {
        try {
            const res = await fetch('https://www.youtube.com/sw.js', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                dispatcher,
                signal: AbortSignal.timeout(3000)
            });
            if (res.ok) {
                const text = await res.text();
                const match = text.match(/visitorData['"]:\s*['"]([^'"]+)['"]/);
                if (match) {
                    cachedVisitorData = match[1];
                    return cachedVisitorData;
                }
            }
        } catch (e) {}
    }

    // 3. Fallback: youtube.com homepage
    try {
        const res = await fetch('https://www.youtube.com/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
            const text = await res.text();
            const match = text.match(/"visitorData":"([^"]+)"/);
            if (match) {
                cachedVisitorData = match[1];
                return cachedVisitorData;
            }
        }
    } catch (e) {}

    return null;
}

/**
 * Helper to parse proxy string and get ProxyAgent and Playwright proxy settings.
 */
function getProxyConfig(proxyInput) {
    if (proxyInput === null || proxyInput === false || proxyInput === '') {
        return { proxyUrl: null, playwrightProxy: undefined };
    }
    const proxyUrl = (proxyInput !== undefined) ? proxyInput : DEFAULT_PROXY;
    if (!proxyUrl) return { proxyUrl: null, playwrightProxy: undefined };

    let playwrightProxy = undefined;
    try {
        const cleanUrl = proxyUrl.replace(/^http:\/\//, '').replace(/^https:\/\//, '');
        const parts = cleanUrl.split('@');
        if (parts.length === 2) {
            const [username, password] = parts[0].split(':');
            const server = 'http://' + parts[1];
            playwrightProxy = { server, username, password };
        } else {
            playwrightProxy = { server: proxyUrl };
        }
    } catch (e) {
        playwrightProxy = undefined;
    }

    return { proxyUrl, playwrightProxy };
}

/**
 * Returns a cached undici ProxyAgent for a given proxy URL.
 */
function getDispatcher(proxyUrl) {
    if (!proxyUrl) return undefined;
    if (!proxyAgentCache.has(proxyUrl)) {
        proxyAgentCache.set(proxyUrl, new ProxyAgent(proxyUrl));
    }
    return proxyAgentCache.get(proxyUrl);
}

/**
 * Lazily initializes and returns singleton Playwright Chromium browser.
 */
async function getBrowser() {
    if (!globalBrowser) {
        globalBrowser = await chromium.launch({
            headless: true,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--autoplay-policy=no-user-gesture-required',
                '--mute-audio',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security'
            ]
        });
    }
    return globalBrowser;
}

/**
 * Fetches and caches YouTube base.js player script.
 */
async function getPlayerJs(dispatcher) {
    if (cachedPlayerJs) return cachedPlayerJs;
    try {
        const res = await fetch(PLAYER_JS_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            dispatcher
        });
        if (res.ok) {
            cachedPlayerJs = await res.text();
            return cachedPlayerJs;
        }
    } catch (e) {
        try {
            const res = await fetch(PLAYER_JS_URL, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            if (res.ok) {
                cachedPlayerJs = await res.text();
                return cachedPlayerJs;
            }
        } catch (err) {}
    }
    return null;
}

/**
 * Deciphers a signatureCipher using extracted JS slice evaluated in Node vm context.
 */
function decipherSignatureCipher(signatureCipher, playerJs) {
    const params = new URLSearchParams(signatureCipher);
    const s = params.get('s');
    const sp = params.get('sp') || 'sig';
    const url = params.get('url');

    if (!s) return url;
    if (!playerJs) return url;

    let decipherFnName, fnMatchStr, helperCode;

    if (cachedDecipherCode) {
        decipherFnName = cachedDecipherCode.decipherFnName;
        fnMatchStr = cachedDecipherCode.fnMatchStr;
        helperCode = cachedDecipherCode.helperCode;
    } else {
        const decipherFnMatch = playerJs.match(/\bc\s*&&\s*d\.set\([^,]+,\s*(?:encodeURIComponent\s*\()?\s*(?:b\.)?(\w+)\(/) ||
                                playerJs.match(/(\w+)\s*=\s*function\([a-zA-Z]\)\s*\{\s*[a-zA-Z]\s*=\s*[a-zA-Z]\.split\(""?\)/);
        if (!decipherFnMatch) throw new Error('Could not find decipher function name');
        decipherFnName = decipherFnMatch[1];

        const fnRegex = new RegExp(`${decipherFnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*function\\s*\\([a-zA-Z]\\)\\s*\\{[^}]+\\}`);
        const fnMatch = playerJs.match(fnRegex);
        if (!fnMatch) throw new Error('Could not extract decipher function body');
        fnMatchStr = fnMatch[0];

        const helperMatch = fnMatchStr.match(/;([a-zA-Z0-9$_]{2,3})\./);
        if (!helperMatch) throw new Error('Could not find helper object name');
        const helperName = helperMatch[1];

        const helperRegex = new RegExp(`var ${helperName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*\\{[\\s\\S]*?\\}\\s*;`);
        const helperMatch2 = playerJs.match(helperRegex);
        if (!helperMatch2) throw new Error('Could not find helper object');
        helperCode = helperMatch2[0];

        cachedDecipherCode = { decipherFnName, fnMatchStr, helperCode };
    }

    const code = `${helperCode}\n${fnMatchStr}\n${decipherFnName}(${JSON.stringify(s)})`;
    const deciphered = vm.runInNewContext(code);

    const delimiter = url.includes('?') ? '&' : '?';
    return `${url}${delimiter}${sp}=${encodeURIComponent(deciphered)}`;
}

/**
 * Primary Native Strategy: ANDROID_VR client context request.
 */
async function tryAndroidVrStrategy(videoId, dispatcher) {
    const visitorData = await getVisitorData(dispatcher);
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.apps.youtube.vr/1.56.22 (Linux; U; Android 12; Quest 3)',
        'X-YouTube-Client-Name': '28',
        'X-YouTube-Client-Version': '1.56.22'
    };
    if (visitorData) {
        headers['X-Goog-Visitor-Id'] = visitorData;
    }

    const clientPayload = {
        clientName: 'ANDROID_VR',
        clientVersion: '1.56.22',
        deviceMake: 'Oculus',
        deviceModel: 'Quest 3',
        osName: 'Android',
        osVersion: '12',
        androidSdkVersion: 32,
        hl: 'en',
        gl: 'US'
    };
    if (visitorData) {
        clientPayload.visitorData = visitorData;
    }

    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            context: {
                client: clientPayload,
                user: { lockedSafetyMode: false }
            },
            videoId,
            racyCheckOk: true,
            contentCheckOk: true,
            playbackContext: {
                contentPlaybackContext: {
                    signatureTimestamp: 20660
                }
            }
        }),
        dispatcher,
        signal: AbortSignal.timeout(5000)
    });

    const data = await res.json();
    if (data.playabilityStatus?.status !== 'OK') {
        return null;
    }

    const formats = [...(data.streamingData?.formats || []), ...(data.streamingData?.adaptiveFormats || [])];
    const audioFmts = formats.filter(f => f.mimeType?.includes('audio'));
    const target = audioFmts.find(f => f.itag === 140) || audioFmts.find(f => f.itag === 251) || audioFmts[0] || formats[0];

    if (target && target.url) {
        return target.url;
    }
    return null;
}

/**
 * Secondary Native Strategy: TVHTML5 client request.
 */
async function tryTvHtml5Strategy(videoId, dispatcher) {
    const visitorData = await getVisitorData(dispatcher);
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (ChromiumStylePlatformal; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.240 Safari/537.36 CrKey/1.56.500000',
        'X-YouTube-Client-Name': '18',
        'X-YouTube-Client-Version': '7.20260308.00.00'
    };
    if (visitorData) {
        headers['X-Goog-Visitor-Id'] = visitorData;
    }

    const clientPayload = {
        clientName: 'TVHTML5',
        clientVersion: '7.20260308.00.00',
        hl: 'en',
        gl: 'US'
    };
    if (visitorData) {
        clientPayload.visitorData = visitorData;
    }

    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            context: {
                client: clientPayload,
                user: { lockedSafetyMode: false }
            },
            videoId,
            racyCheckOk: true,
            contentCheckOk: true
        }),
        dispatcher,
        signal: AbortSignal.timeout(5000)
    });

    const data = await res.json();
    if (data.playabilityStatus?.status !== 'OK') {
        return null;
    }

    const formats = [...(data.streamingData?.formats || []), ...(data.streamingData?.adaptiveFormats || [])];
    const audioFmts = formats.filter(f => f.mimeType?.includes('audio'));
    const target = audioFmts.find(f => f.itag === 140) || audioFmts.find(f => f.itag === 251) || audioFmts[0] || formats[0];

    if (target && target.url) {
        return target.url;
    }
    return null;
}

/**
 * Strategy: WEB client + STS (20660) + Node vm deciphering.
 */
async function tryWebDecipherStrategy(videoId, dispatcher) {
    const visitorData = await getVisitorData(dispatcher);
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://www.youtube.com',
        'Referer': `https://www.youtube.com/watch?v=${videoId}`,
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20260725.00.00'
    };
    if (visitorData) {
        headers['X-Goog-Visitor-Id'] = visitorData;
    }

    const clientPayload = {
        clientName: 'WEB',
        clientVersion: '2.20260725.00.00',
        hl: 'en',
        gl: 'US'
    };
    if (visitorData) {
        clientPayload.visitorData = visitorData;
    }

    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            context: {
                client: clientPayload,
                user: { lockedSafetyMode: false }
            },
            videoId,
            racyCheckOk: true,
            contentCheckOk: true,
            playbackContext: {
                contentPlaybackContext: {
                    signatureTimestamp: 20660,
                    html5Preference: 'HTML5_PREF_WANTS'
                }
            }
        }),
        dispatcher,
        signal: AbortSignal.timeout(5000)
    });

    const data = await res.json();
    if (data.playabilityStatus?.status !== 'OK') {
        return null;
    }

    const formats = [...(data.streamingData?.formats || []), ...(data.streamingData?.adaptiveFormats || [])];
    const audioFmts = formats.filter(f => f.mimeType?.includes('audio'));
    const target = audioFmts.find(f => f.itag === 140) || audioFmts.find(f => f.itag === 251) || audioFmts[0] || formats[0];

    if (!target) return null;

    if (target.url) {
        return target.url;
    }

    if (target.signatureCipher) {
        const playerJs = await getPlayerJs(dispatcher);
        if (playerJs) {
            return decipherSignatureCipher(target.signatureCipher, playerJs);
        }
    }

    return null;
}

/**
 * Runs Playwright embed page request interception.
 */
async function runPlaywrightInterception(videoId, playwrightProxy, timeout = 15000) {
    let browser = null;
    let context = null;
    try {
        if (playwrightProxy) {
            // Launch separate browser instance for authenticated proxy requests
            browser = await chromium.launch({
                headless: true,
                proxy: playwrightProxy,
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--autoplay-policy=no-user-gesture-required',
                    '--mute-audio',
                    '--no-sandbox',
                    '--disable-setuid-sandbox'
                ]
            });
            context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
        } else {
            const globalB = await getBrowser();
            context = await globalB.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
        }

        // Inject consent cookie SOCS=CAI to bypass GDPR consent pages
        await context.addCookies([
            {
                name: 'SOCS',
                value: 'CAI',
                domain: '.youtube.com',
                path: '/'
            }
        ]);

        const page = await context.newPage();

        return await new Promise(async (resolve, reject) => {
            let resolved = false;

            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    reject(new Error('Playwright request interception timed out'));
                }
            }, timeout);

            page.on('request', req => {
                const url = req.url();
                if (url.includes('googlevideo.com/videoplayback')) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        resolve(url);
                    }
                }
            });

            try {
                // Use standard watch page to trigger videoplayback request interception
                await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
                    waitUntil: 'commit',
                    timeout
                });
            } catch (e) {
                if (!resolved) {
                    clearTimeout(timer);
                    reject(e);
                }
            }
        });
    } finally {
        if (context) {
            try { await context.close(); } catch (e) {}
        }
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                try {
                    const proc = browser.process();
                    if (proc && !proc.killed) proc.kill('SIGKILL');
                } catch (err) {}
            }
        }
    }
}

/**
 * Emergency Fallback Strategy: Playwright stealth browser interception.
 */
async function tryPlaywrightFallback(videoId, playwrightProxy, timeout = 30000) {
    // 1. Try over proxy with max 5s timeout if proxy is provided
    if (playwrightProxy) {
        try {
            const url = await runPlaywrightInterception(videoId, playwrightProxy, Math.min(timeout, 5000));
            if (url) return url;
        } catch (e) {
            // Proxy failover to direct connection
        }
    }

    // 2. Direct Playwright connection
    return await runPlaywrightInterception(videoId, undefined, timeout);
}

/**
 * Gets the decrypted YouTube stream URL for a given video ID.
 * Primary: ANDROID_VR direct unencrypted InnerTube API
 * Secondary: TVHTML5 / WEB client InnerTube API
 * Fallback: Playwright stealth embed browser interception
 * 
 * @param {string} videoId The YouTube video ID.
 * @param {Object} [options] Configuration options.
 * @param {string} [options.proxy] Proxy URL (defaults to http://huautker:uqtmxj0tnnpq@198.105.121.200:6462).
 * @param {number} [options.timeout=30000] Timeout in milliseconds.
 * @param {boolean} [options.disableNative=false] Artificially disable native methods for fallback testing.
 * @returns {Promise<string>} The stream URL.
 */
async function getStreamUrl(videoId, options = {}) {
    if (options.disableNative || process.env.DISABLE_NATIVE === 'true') {
        const timeout = options.timeout || 30000;
        const proxyInfo = getProxyConfig(options.proxy);
        return await tryPlaywrightFallback(videoId, proxyInfo.playwrightProxy, timeout);
    }

    const timeout = options.timeout || 30000;
    const proxyInfo = getProxyConfig(options.proxy);
    const dispatcher = proxyInfo.proxyUrl ? getDispatcher(proxyInfo.proxyUrl) : undefined;

    // Strategy 1: ANDROID_VR direct API request (Fastest: < 1.5s initial, ~150ms cached)
    try {
        const vrUrl = await tryAndroidVrStrategy(videoId, undefined);
        if (vrUrl) return vrUrl;
    } catch (e) {}

    // Strategy 2: TVHTML5 direct API request
    try {
        const tvUrl = await tryTvHtml5Strategy(videoId, undefined);
        if (tvUrl) return tvUrl;
    } catch (e) {}

    // Strategy 3: ANDROID_VR over proxy
    if (dispatcher) {
        try {
            const vrUrlProxy = await tryAndroidVrStrategy(videoId, dispatcher);
            if (vrUrlProxy) return vrUrlProxy;
        } catch (e) {}
    }

    // Strategy 4: WEB decipher strategy
    try {
        const webUrl = await tryWebDecipherStrategy(videoId, undefined);
        if (webUrl) return webUrl;
    } catch (e) {}

    // Emergency Fallback: Playwright stealth browser interception
    return await tryPlaywrightFallback(videoId, proxyInfo.playwrightProxy, timeout);
}

// Cleanup browser resources when process exits or receives termination signals
function killGlobalBrowser() {
    if (globalBrowser) {
        try {
            const proc = globalBrowser.process();
            if (proc && !proc.killed) {
                proc.kill();
            }
        } catch (e) {}
    }
}

process.on('exit', () => {
    killGlobalBrowser();
});

process.on('SIGINT', () => {
    killGlobalBrowser();
    process.exit(130);
});

process.on('SIGTERM', () => {
    killGlobalBrowser();
    process.exit(143);
});

module.exports = { getStreamUrl };
