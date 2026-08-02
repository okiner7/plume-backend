const { ProxyAgent, fetch } = require('undici');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

chromium.use(stealth);

/**
 * Parse Netscape cookies.txt format into array of cookie objects for Playwright and header string.
 */
function loadCookiesFromFile(cookieFilePath) {
    try {
        const filePath = cookieFilePath || path.join(__dirname, 'cookies.txt');
        if (!fs.existsSync(filePath)) return { playwrightCookies: [], cookieHeader: '' };
        const lines = fs.readFileSync(filePath, 'utf8').split('\n');
        const playwrightCookies = [];
        const cookiePairs = [];
        for (const line of lines) {
            if (!line || line.startsWith('#')) continue;
            const parts = line.split('\t');
            if (parts.length < 7) continue;
            const [domain, , , secure, expiresStr, name, value] = parts;
            const expires = parseInt(expiresStr, 10);
            playwrightCookies.push({
                name: name.trim(),
                value: value.trim(),
                domain: domain.startsWith('.') ? domain : `.${domain}`,
                path: '/',
                secure: secure === 'TRUE',
                httpOnly: false,
                sameSite: 'None',
                expires: expires > 0 ? expires : undefined
            });
            cookiePairs.push(`${name.trim()}=${value.trim()}`);
        }
        return { playwrightCookies, cookieHeader: cookiePairs.join('; ') };
    } catch (e) {
        return { playwrightCookies: [], cookieHeader: '' };
    }
}

const { playwrightCookies: LOADED_COOKIES, cookieHeader: COOKIE_HEADER } = loadCookiesFromFile();

/**
 * Checks if an error is due to a closed CDP session, page, context, or browser target.
 */
function isClosedError(err) {
    if (!err) return false;
    const msg = err.message || String(err);
    return (
        msg.includes('Target page, context or browser has been closed') ||
        msg.includes('Target closed') ||
        msg.includes('Browser has been closed') ||
        msg.includes('Session closed') ||
        msg.includes('cdpSession.send') ||
        msg.includes('Protocol error')
    );
}

// Global process safety guard for unhandled CDP session rejections during background teardown
process.on('unhandledRejection', (reason) => {
    if (isClosedError(reason)) {
        return;
    }
});

function createDummyCDPSession() {
    return {
        send: async () => undefined,
        on: () => {},
        off: () => {},
        removeListener: () => {},
        detach: async () => {}
    };
}

function guardCDPSession(session) {
    if (!session || session._guarded) return session;
    if (typeof session.send === 'function') {
        const origSend = session.send.bind(session);
        session.send = async function(method, params) {
            try {
                return await origSend(method, params);
            } catch (err) {
                if (isClosedError(err)) {
                    return undefined;
                }
                throw err;
            }
        };
    }
    session._guarded = true;
    return session;
}

function guardContext(context) {
    if (!context || context._guarded) return context;
    if (typeof context.newCDPSession === 'function') {
        const origNewCDPSession = context.newCDPSession.bind(context);
        context.newCDPSession = async function(page) {
            try {
                const session = await origNewCDPSession(page);
                return guardCDPSession(session);
            } catch (err) {
                if (isClosedError(err)) {
                    return createDummyCDPSession();
                }
                throw err;
            }
        };
    }
    context._guarded = true;
    return context;
}

function guardBrowser(browser) {
    if (!browser) return browser;

    if (typeof browser.newBrowserCDPSession === 'function' && !browser._guardedCDP) {
        const origBrowserCDPSession = browser.newBrowserCDPSession.bind(browser);
        browser.newBrowserCDPSession = async function() {
            try {
                const session = await origBrowserCDPSession();
                return guardCDPSession(session);
            } catch (err) {
                if (isClosedError(err)) {
                    return createDummyCDPSession();
                }
                throw err;
            }
        };
        browser._guardedCDP = true;
    }

    if (typeof browser.newContext === 'function' && !browser._guardedContext) {
        const origNewContext = browser.newContext.bind(browser);
        browser.newContext = async function(...args) {
            const context = await origNewContext(...args);
            return guardContext(context);
        };
        browser._guardedContext = true;
    }

    return browser;
}

const DEFAULT_PROXY = '';
const PLAYER_JS_URL = 'https://www.youtube.com/s/player/b81a9a58/player_es6.vflset/ru_RU/base.js';
const ITAG_PRIORITY = [258, 256, 141, 251, 171, 140, 250, 249, 139, 95, 94, 93, 92];

const proxyAgentCache = new Map();
let globalBrowser = null;
let cachedPlayerJs = null;
let cachedDecipherCode = null;
let cachedVisitorData = null;
let visitorDataFetchPromise = null;
let lastUnplayableReason = null;

/**
 * Pre-fetches & caches YouTube visitorData token in memory.
 */
async function getVisitorData(dispatcher) {
    if (cachedVisitorData) return cachedVisitorData;
    if (visitorDataFetchPromise) return visitorDataFetchPromise;

    visitorDataFetchPromise = (async () => {
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
    })();

    const result = await visitorDataFetchPromise;
    visitorDataFetchPromise = null;
    return result;
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

let browserInitPromise = null;

/**
 * Lazily initializes and returns singleton Playwright Chromium browser.
 */
async function getBrowser() {
    if (globalBrowser && globalBrowser.isConnected()) {
        return globalBrowser;
    }
    if (browserInitPromise) {
        return browserInitPromise;
    }
    browserInitPromise = (async () => {
        try {
            const b = await chromium.launch({
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
            guardBrowser(b);
            globalBrowser = b;
            return globalBrowser;
        } finally {
            browserInitPromise = null;
        }
    })();
    return browserInitPromise;
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
 * Dynamically selects the best audio format by numeric bitrate, quality enums, and ITAG priority rank.
 * Prioritizes 256kbps AAC (itag 141/256) / 160kbps OPUS (itag 251) over 128kbps AAC (itag 140).
 */
function selectBestAudioFormat(formats) {
    if (!Array.isArray(formats) || formats.length === 0) return null;

    const audioFormats = formats.filter(f => {
        if (!f) return false;
        const mime = f.mimeType || '';
        const isAudioMime = mime.includes('audio');
        const hasNoVideo = !f.width && !f.height && !f.qualityLabel;
        return isAudioMime || (hasNoVideo && (f.bitrate || f.averageBitrate || f.audioQuality));
    });

    const candidates = audioFormats.length > 0 ? audioFormats : formats;

    function getItagRank(itag) {
        const idx = ITAG_PRIORITY.indexOf(Number(itag));
        return idx !== -1 ? idx : 999;
    }

    function getBitrate(f) {
        return Math.max(Number(f.bitrate || 0), Number(f.averageBitrate || 0));
    }

    function getQualityScore(f) {
        const q = String(f.audioQuality || '').toUpperCase();
        if (q.includes('HIGH')) return 3;
        if (q.includes('MEDIUM')) return 2;
        if (q.includes('LOW')) return 1;
        return 0;
    }

    candidates.sort((a, b) => {
        // 1. ITAG priority rank
        const rankA = getItagRank(a.itag);
        const rankB = getItagRank(b.itag);
        if (rankA !== rankB) return rankA - rankB;

        // 2. Numeric bitrate descending
        const bitA = getBitrate(a);
        const bitB = getBitrate(b);
        if (bitA !== bitB) return bitB - bitA;

        // 3. Audio quality score descending
        const qA = getQualityScore(a);
        const qB = getQualityScore(b);
        return qB - qA;
    });

    return candidates[0];
}

/**
 * ANDROID_VR client strategy.
 */
async function tryAndroidVrStrategy(videoId, dispatcher, visitorData) {
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.apps.youtube.vr/1.56.22 (Linux; U; Android 12; Quest 3)',
        'X-YouTube-Client-Name': '28',
        'X-YouTube-Client-Version': '1.56.22'
    };
    if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;

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
    if (visitorData) clientPayload.visitorData = visitorData;

    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            context: { client: clientPayload, user: { lockedSafetyMode: false } },
            videoId,
            racyCheckOk: true,
            contentCheckOk: true,
            playbackContext: { contentPlaybackContext: { signatureTimestamp: 20660 } }
        }),
        dispatcher,
        signal: AbortSignal.timeout(4000)
    });

    const data = await res.json();
    if (data.playabilityStatus?.status === 'UNPLAYABLE') {
        lastUnplayableReason = data.playabilityStatus.reason || 'This video is unplayable';
        return null;
    }
    if (data.playabilityStatus?.status !== 'OK' && !data.streamingData?.hlsManifestUrl) return null;

    const formats = [...(data.streamingData?.formats || []), ...(data.streamingData?.adaptiveFormats || [])];
    const target = selectBestAudioFormat(formats);
    if (target) {
        if (target.url) return target;
        if (target.signatureCipher) {
            const playerJs = await getPlayerJs(dispatcher);
            if (playerJs) {
                const decipheredUrl = decipherSignatureCipher(target.signatureCipher, playerJs);
                return { ...target, url: decipheredUrl };
            }
        }
    }

    if (data.streamingData?.hlsManifestUrl) {
        return {
            url: data.streamingData.hlsManifestUrl,
            itag: 95,
            bitrate: 128000,
            mimeType: 'application/x-mpegURL; codecs="mp4a.40.2"',
            audioQuality: 'AUDIO_QUALITY_MEDIUM'
        };
    }

    return null;
}

/**
 * IOS client strategy.
 */
async function tryIosStrategy(videoId, dispatcher, visitorData) {
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; en_US)',
        'X-YouTube-Client-Name': '5',
        'X-YouTube-Client-Version': '19.45.4'
    };
    if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;

    const clientPayload = {
        clientName: 'IOS',
        clientVersion: '19.45.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iOS',
        osVersion: '17.5.1.21F90',
        hl: 'en',
        gl: 'US'
    };
    if (visitorData) clientPayload.visitorData = visitorData;

    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            context: { client: clientPayload, user: { lockedSafetyMode: false } },
            videoId,
            racyCheckOk: true,
            contentCheckOk: true,
            playbackContext: { contentPlaybackContext: { signatureTimestamp: 20660 } }
        }),
        dispatcher,
        signal: AbortSignal.timeout(4000)
    });

    const data = await res.json();
    if (data.playabilityStatus?.status === 'UNPLAYABLE') {
        lastUnplayableReason = data.playabilityStatus.reason || 'This video is unplayable';
        return null;
    }
    if (data.playabilityStatus?.status !== 'OK' && !data.streamingData?.hlsManifestUrl) return null;

    const formats = [...(data.streamingData?.formats || []), ...(data.streamingData?.adaptiveFormats || [])];
    const target = selectBestAudioFormat(formats);
    if (target) {
        if (target.url) return target;
        if (target.signatureCipher) {
            const playerJs = await getPlayerJs(dispatcher);
            if (playerJs) {
                const decipheredUrl = decipherSignatureCipher(target.signatureCipher, playerJs);
                return { ...target, url: decipheredUrl };
            }
        }
    }

    if (data.streamingData?.hlsManifestUrl) {
        return {
            url: data.streamingData.hlsManifestUrl,
            itag: 95,
            bitrate: 128000,
            mimeType: 'application/x-mpegURL; codecs="mp4a.40.2"',
            audioQuality: 'AUDIO_QUALITY_MEDIUM'
        };
    }

    return null;
}

/**
 * ANDROID_MUSIC client strategy.
 */
async function tryAndroidMusicStrategy(videoId, dispatcher, visitorData) {
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.apps.youtube.music/6.42.52 (Linux; U; Android 12; Pixel 6)',
        'X-YouTube-Client-Name': '21',
        'X-YouTube-Client-Version': '6.42.52'
    };
    if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;

    const clientPayload = {
        clientName: 'ANDROID_MUSIC',
        clientVersion: '6.42.52',
        deviceMake: 'Google',
        deviceModel: 'Pixel 6',
        osName: 'Android',
        osVersion: '12',
        androidSdkVersion: 31,
        hl: 'en',
        gl: 'US'
    };
    if (visitorData) clientPayload.visitorData = visitorData;

    const res = await fetch('https://music.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            context: { client: clientPayload, user: { lockedSafetyMode: false } },
            videoId,
            racyCheckOk: true,
            contentCheckOk: true,
            playbackContext: { contentPlaybackContext: { signatureTimestamp: 20660 } }
        }),
        dispatcher,
        signal: AbortSignal.timeout(4000)
    });

    const data = await res.json();
    if (data.playabilityStatus?.status === 'UNPLAYABLE') {
        lastUnplayableReason = data.playabilityStatus.reason || 'This video is unplayable';
        return null;
    }
    if (data.playabilityStatus?.status !== 'OK' && !data.streamingData?.hlsManifestUrl) return null;

    const formats = [...(data.streamingData?.formats || []), ...(data.streamingData?.adaptiveFormats || [])];
    const target = selectBestAudioFormat(formats);
    if (target) {
        if (target.url) return target;
        if (target.signatureCipher) {
            const playerJs = await getPlayerJs(dispatcher);
            if (playerJs) {
                const decipheredUrl = decipherSignatureCipher(target.signatureCipher, playerJs);
                return { ...target, url: decipheredUrl };
            }
        }
    }

    if (data.streamingData?.hlsManifestUrl) {
        return {
            url: data.streamingData.hlsManifestUrl,
            itag: 95,
            bitrate: 128000,
            mimeType: 'application/x-mpegURL; codecs="mp4a.40.2"',
            audioQuality: 'AUDIO_QUALITY_MEDIUM'
        };
    }

    return null;
}

/**
 * TVHTML5 client strategy.
 */
async function tryTvHtml5Strategy(videoId, dispatcher, visitorData) {
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (ChromiumStylePlatformal; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.240 Safari/537.36 CrKey/1.56.500000',
        'X-YouTube-Client-Name': '18',
        'X-YouTube-Client-Version': '7.20260308.00.00'
    };
    if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;

    const clientPayload = {
        clientName: 'TVHTML5',
        clientVersion: '7.20260308.00.00',
        hl: 'en',
        gl: 'US'
    };
    if (visitorData) clientPayload.visitorData = visitorData;

    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            context: { client: clientPayload, user: { lockedSafetyMode: false } },
            videoId,
            racyCheckOk: true,
            contentCheckOk: true
        }),
        dispatcher,
        signal: AbortSignal.timeout(4000)
    });

    const data = await res.json();
    if (data.playabilityStatus?.status === 'UNPLAYABLE') {
        lastUnplayableReason = data.playabilityStatus.reason || 'This video is unplayable';
        return null;
    }
    if (data.playabilityStatus?.status !== 'OK' && !data.streamingData?.hlsManifestUrl) return null;

    const formats = [...(data.streamingData?.formats || []), ...(data.streamingData?.adaptiveFormats || [])];
    const target = selectBestAudioFormat(formats);
    if (target) {
        if (target.url) return target;
        if (target.signatureCipher) {
            const playerJs = await getPlayerJs(dispatcher);
            if (playerJs) {
                const decipheredUrl = decipherSignatureCipher(target.signatureCipher, playerJs);
                return { ...target, url: decipheredUrl };
            }
        }
    }

    if (data.streamingData?.hlsManifestUrl) {
        return {
            url: data.streamingData.hlsManifestUrl,
            itag: 95,
            bitrate: 128000,
            mimeType: 'application/x-mpegURL; codecs="mp4a.40.2"',
            audioQuality: 'AUDIO_QUALITY_MEDIUM'
        };
    }

    return null;
}

/**
 * Strategy: WEB client + STS (20660) + Node vm deciphering.
 */
async function tryWebDecipherStrategy(videoId, dispatcher, visitorData) {
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://www.youtube.com',
        'Referer': `https://www.youtube.com/watch?v=${videoId}`,
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20260725.00.00'
    };
    if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;

    const clientPayload = {
        clientName: 'WEB',
        clientVersion: '2.20260725.00.00',
        hl: 'en',
        gl: 'US'
    };
    if (visitorData) clientPayload.visitorData = visitorData;

    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            context: { client: clientPayload, user: { lockedSafetyMode: false } },
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
        signal: AbortSignal.timeout(4000)
    });

    const data = await res.json();
    if (data.playabilityStatus?.status === 'UNPLAYABLE') {
        lastUnplayableReason = data.playabilityStatus.reason || 'This video is unplayable';
        return null;
    }
    if (data.playabilityStatus?.status !== 'OK' && !data.streamingData?.hlsManifestUrl) return null;

    const formats = [...(data.streamingData?.formats || []), ...(data.streamingData?.adaptiveFormats || [])];
    const target = selectBestAudioFormat(formats);
    if (target) {
        if (target.url) return target;
        if (target.signatureCipher) {
            const playerJs = await getPlayerJs(dispatcher);
            if (playerJs) {
                const decipheredUrl = decipherSignatureCipher(target.signatureCipher, playerJs);
                return { ...target, url: decipheredUrl };
            }
        }
    }

    if (data.streamingData?.hlsManifestUrl) {
        return {
            url: data.streamingData.hlsManifestUrl,
            itag: 95,
            bitrate: 128000,
            mimeType: 'application/x-mpegURL; codecs="mp4a.40.2"',
            audioQuality: 'AUDIO_QUALITY_MEDIUM'
        };
    }

    return null;
}

/**
 * Parallel strategy racing engine across candidate native InnerTube clients using Promise.any.
 */
async function raceNativeStrategies(videoId, dispatcher, visitorData) {
    const candidateTasks = [
        tryAndroidVrStrategy(videoId, dispatcher, visitorData),
        tryIosStrategy(videoId, dispatcher, visitorData),
        tryAndroidMusicStrategy(videoId, dispatcher, visitorData),
        tryTvHtml5Strategy(videoId, dispatcher, visitorData)
    ].map(p => p.then(res => {
        if (!res || !res.url) throw new Error('Strategy failed');
        return res;
    }));

    try {
        return await Promise.any(candidateTasks);
    } catch (e) {
        return null;
    }
}

/**
 * Runs Playwright embed page request interception.
 */
async function runPlaywrightInterception(videoId, playwrightProxy, timeout = 15000) {
    let browser = null;
    let context = null;
    try {
        if (playwrightProxy) {
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
            guardBrowser(browser);
            context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
        } else {
            const globalB = await getBrowser();
            context = await globalB.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
        }

        const cookiesToAdd = LOADED_COOKIES.length > 0
            ? LOADED_COOKIES
            : [{ name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' }];
        await context.addCookies(cookiesToAdd);

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
                try {
                    const url = req.url();
                    if (url.includes('googlevideo.com/videoplayback') || url.includes('googlevideo.com/api/manifest/hls')) {
                        // Prefer audio-only streams (mime=audio), skip video/mp4 combined streams
                        const isAudio = url.includes('mime=audio') || url.includes('mime%3Daudio');
                        const isVideo = url.includes('mime=video') || url.includes('mime%3Dvideo');
                        if (!resolved && (isAudio || (!isVideo && url.includes('videoplayback')))) {
                            resolved = true;
                            clearTimeout(timer);
                            // Try to parse itag from URL
                            const itagMatch = url.match(/[?&]itag=(\d+)/);
                            const itag = itagMatch ? parseInt(itagMatch[1]) : 251;
                            resolve({
                                url,
                                itag,
                                bitrate: itag === 251 ? 160000 : 128000,
                                mimeType: itag === 251 ? 'audio/webm; codecs="opus"' : 'audio/mp4; codecs="mp4a.40.2"',
                                audioQuality: 'AUDIO_QUALITY_MEDIUM'
                            });
                        }
                    }
                } catch (e) {}
            });

            try {
                await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
                    waitUntil: 'commit',
                    timeout
                });
            } catch (e) {
                if (!resolved) {
                    resolved = true;
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
            try { await browser.close(); } catch (e) {}
        }
    }
}

/**
 * Emergency Fallback Strategy: Playwright stealth browser interception.
 */
async function tryPlaywrightFallback(videoId, playwrightProxy, timeout = 15000) {
    if (playwrightProxy) {
        try {
            const result = await runPlaywrightInterception(videoId, playwrightProxy, Math.min(timeout, 5000));
            if (result && result.url) return result;
        } catch (e) {}
    }
    return await runPlaywrightInterception(videoId, undefined, timeout);
}

/**
 * Gets the decrypted YouTube stream URL or detailed metadata object for a given video ID.
 * Primary: Native InnerTube API clients (ANDROID_VR, IOS, ANDROID_MUSIC, TVHTML5) via Promise.any racing
 * Secondary: WEB client InnerTube API with Node vm deciphering
 * Fallback: Playwright stealth embed browser interception
 * 
 * @param {string} videoId The YouTube video ID.
 * @param {Object} [options] Configuration options.
 * @param {string} [options.proxy] Proxy URL (defaults to http://huautker:uqtmxj0tnnpq@198.105.121.200:6462).
 * @param {number} [options.timeout=30000] Timeout in milliseconds.
 * @param {boolean} [options.disableNative=false] Artificially disable native methods for fallback testing.
 * @param {boolean} [options.returnObject=false] Return detailed stream metadata object instead of URL string.
 * @param {boolean} [options.fullMetadata=false] Alias for returnObject.
 * @returns {Promise<string|Object>} The stream URL or metadata object.
 */
async function getStreamUrl(videoId, options = {}) {
    const startTime = Date.now();
    const returnObj = !!(options.returnObject || options.fullMetadata || options.returnMetadata);
    lastUnplayableReason = null;

    if (options.disableNative || process.env.DISABLE_NATIVE === 'true') {
        const timeout = options.timeout || 15000;
        const proxyInfo = getProxyConfig(options.proxy);
        const res = await tryPlaywrightFallback(videoId, proxyInfo.playwrightProxy, timeout);
        const elapsedMs = Date.now() - startTime;

        if (returnObj) {
            const codecMatch = (res.mimeType || '').match(/codecs="([^"]+)"/);
            return {
                url: res.url,
                format: res.mimeType,
                itag: res.itag || 140,
                bitrate: res.bitrate || 128000,
                mimeType: res.mimeType || 'audio/mp4; codecs="mp4a.40.2"',
                codec: codecMatch ? codecMatch[1] : 'mp4a.40.2',
                latencyMs: elapsedMs
            };
        }
        return res.url;
    }

    const timeout = options.timeout || 30000;
    const proxyInfo = getProxyConfig(options.proxy);
    const dispatcher = proxyInfo.proxyUrl ? getDispatcher(proxyInfo.proxyUrl) : undefined;

    // Pre-fetch/cache visitorData token
    const visitorData = await getVisitorData(dispatcher);

    // 1. Direct Parallel Racing engine across candidate native InnerTube clients
    let target = await raceNativeStrategies(videoId, undefined, visitorData);

    // 2. Secondary: Parallel Racing over proxy if direct fails and proxy is available
    if (!target && dispatcher) {
        target = await raceNativeStrategies(videoId, dispatcher, visitorData);
    }

    // 3. Tertiary: WEB client with STS + Node vm deciphering
    if (!target) {
        target = await tryWebDecipherStrategy(videoId, undefined, visitorData);
    }
    if (!target && dispatcher) {
        target = await tryWebDecipherStrategy(videoId, dispatcher, visitorData);
    }

    // 4. Fast-fail if native strategies confirmed video is unplayable
    if (!target || !target.url) {
        if (lastUnplayableReason) {
            const reason = lastUnplayableReason;
            lastUnplayableReason = null;
            throw new Error(`Video is unplayable: ${reason}`);
        }
        target = await tryPlaywrightFallback(videoId, proxyInfo.playwrightProxy, timeout);
    }

    if (!target || !target.url) {
        throw new Error(`Failed to extract audio stream URL for videoId: ${videoId}`);
    }

    const elapsedMs = Date.now() - startTime;
    const codecMatch = (target.mimeType || '').match(/codecs="([^"]+)"/);
    const codecStr = codecMatch ? codecMatch[1] : (target.mimeType?.includes('opus') ? 'opus' : 'aac');
    const calculatedBitrate = Math.max(Number(target.bitrate || 0), Number(target.averageBitrate || 0)) || 128000;

    if (returnObj) {
        return {
            url: target.url,
            format: target.mimeType,
            itag: target.itag,
            bitrate: calculatedBitrate,
            mimeType: target.mimeType,
            codec: codecStr,
            latencyMs: elapsedMs
        };
    }

    return target.url;
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

module.exports = { getStreamUrl, selectBestAudioFormat };
