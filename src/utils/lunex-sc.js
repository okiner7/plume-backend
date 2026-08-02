const fs = require('fs');
const path = require('path');
const { ProxyAgent, Agent } = require('undici');

// Static fallback client_ids
const FALLBACK_CLIENT_IDS = [
  'sUn5toeW5d8MC2jOLpE2yAibTG7RRYsA',
  'nIjtjiYnjkOhMyh5xrbqEW12DxeJVnic',
  'gqKBMSuBw5rbN9rDRYPqKNvF17ovlObu',
  'iZqKCqYHjEjVuJRznKX8mWpM19Yx3b5f',
  '2t9WoKWFxYeWRUeWUXb68dM06Er7bWor',
  'N2IrY8CE20xN95hNfW1m9j278qB5wX1Z'
];

const DEFAULT_MOBILE_USER_AGENT = 'SoundCloud/2024.05.01-release (Android 14; Mobile; arm64-v8a)';
const DEFAULT_CLIENT_TYPE = 'android';
const DEFAULT_APP_VERSION = '2024.05.01-release';

let globalUndiciDispatcher = null;
try {
  globalUndiciDispatcher = new Agent({
    keepAliveTimeout: 30000,
    keepAliveMaxTimeout: 60000,
    pipelining: 1
  });
} catch (e) {}

/**
 * Custom fetch wrapper supporting proxies with automatic fallback on network/dispatcher failure
 */
async function makeFetch(url, options = {}) {
  const proxyUrl = options.proxy !== undefined ? options.proxy : (process.env.HTTPS_PROXY || process.env.HTTP_PROXY);
  const fetchOptions = { ...options };
  delete fetchOptions.proxy;

  if (proxyUrl && !fetchOptions.dispatcher) {
    try {
      fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
    } catch (e) {}
  } else if (!fetchOptions.dispatcher && globalUndiciDispatcher) {
    fetchOptions.dispatcher = globalUndiciDispatcher;
  }

  try {
    return await fetch(url, fetchOptions);
  } catch (err) {
    // If request failed with custom dispatcher/proxy, retry once with standard native fetch
    if (fetchOptions.dispatcher) {
      delete fetchOptions.dispatcher;
      try {
        return await fetch(url, fetchOptions);
      } catch (fallbackErr) {
        throw fallbackErr;
      }
    }
    throw err;
  }
}

/**
 * Extract 32-character client_id candidates from text using regex patterns
 */
function extractClientIdsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const ids = new Set();

  const regexes = [
    /client_id[:=]\s*["']?([a-zA-Z0-9]{32})(?![a-zA-Z0-9])["']?/gi,
    /["']client_id["']\s*:\s*["']([a-zA-Z0-9]{32})(?![a-zA-Z0-9])["']/gi,
    /[?&]client_id=([a-zA-Z0-9]{32})(?![a-zA-Z0-9])/gi,
    /client_id\s*[:=]\s*[^"'\n]{0,50}["']([a-zA-Z0-9]{32})["']/gi,
    /["']([a-zA-Z0-9]{32})["']\s*:\s*["']([a-zA-Z0-9]{32})["']/gi
  ];

  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[1] && match[1].length === 32) ids.add(match[1]);
      if (match[2] && match[2].length === 32) ids.add(match[2]);
    }
  }

  return Array.from(ids);
}

/**
 * Scrape fresh client_ids from SoundCloud homepage HTML and JS asset bundles
 */
async function scrapeFreshClientIds(options = {}) {
  const userAgent = options.userAgent || DEFAULT_MOBILE_USER_AGENT;
  const headers = {
    'User-Agent': userAgent,
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };

  const foundIds = new Set();

  const scrapePage = async (pageUrl) => {
    try {
      const res = await makeFetch(pageUrl, { headers, proxy: options.proxy, signal: options.signal });
      if (!res.ok) return;

      const html = await res.text();
      extractClientIdsFromText(html).forEach(id => foundIds.add(id));

      const scriptRegex = /<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi;
      const scriptUrls = [];
      let match;
      const origin = new URL(pageUrl).origin;
      while ((match = scriptRegex.exec(html)) !== null) {
        let src = match[1];
        if (src.startsWith('//')) src = 'https:' + src;
        else if (src.startsWith('/')) src = origin + src;
        if (src.includes('sndcdn.com/assets/') || src.includes('/assets/') || src.includes('widget.sndcdn.com/')) {
          scriptUrls.push(src);
        }
      }

      const targetScripts = scriptUrls.slice(-8);

      await Promise.all(
        targetScripts.map(async (url) => {
          try {
            const jsRes = await makeFetch(url, { headers: { 'User-Agent': userAgent }, proxy: options.proxy, signal: options.signal });
            if (jsRes.ok) {
              const jsText = await jsRes.text();
              extractClientIdsFromText(jsText).forEach(id => foundIds.add(id));
            }
          } catch (e) {}
        })
      );
    } catch (err) {}
  };

  await Promise.all([
    scrapePage('https://soundcloud.com'),
    scrapePage('https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/293')
  ]);

  return Array.from(foundIds);
}

/**
 * Validate a client_id against SoundCloud API
 */
async function validateClientId(clientId, options = {}) {
  if (!clientId || typeof clientId !== 'string' || clientId.length !== 32) return false;
  const userAgent = options.userAgent || DEFAULT_MOBILE_USER_AGENT;
  const testUrl = `https://api-v2.soundcloud.com/users?client_id=${clientId}&limit=1`;

  try {
    const res = await makeFetch(testUrl, { headers: { 'User-Agent': userAgent }, proxy: options.proxy, signal: options.signal });
    return res.status === 200 || res.status === 206 || res.status === 404;
  } catch (err) {
    return false;
  }
}

/**
 * ClientIdManager - Handles dynamic scraping, in-memory & disk caching, rotation.
 */
class ClientIdManager {
  constructor(options = {}) {
    this.cacheFilePath = options.cacheFilePath || path.join(process.cwd(), '.client_id_cache.json');
    this.ttlMs = options.ttlMs || 24 * 60 * 60 * 1000;
    this.proxy = options.proxy !== undefined ? options.proxy : (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null);
    this.fallbackClientIds = options.fallbackClientIds || [...FALLBACK_CLIENT_IDS];
    this.userAgent = options.userAgent || DEFAULT_MOBILE_USER_AGENT;
    this.pool = [];
    this.activeId = null;
    this.cacheTimestamp = null;
    this.refreshPromise = null;
  }

  loadDiskCache() {
    try {
      if (!fs.existsSync(this.cacheFilePath)) return false;
      const data = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf8'));
      if (!data || !data.timestamp || !Array.isArray(data.clientIds) || data.clientIds.length === 0) return false;
      if ((Date.now() - data.timestamp) > this.ttlMs) return false;

      this.pool = data.clientIds;
      this.activeId = data.activeId || data.clientIds[0];
      this.cacheTimestamp = data.timestamp;
      return true;
    } catch (err) {
      return false;
    }
  }

  saveDiskCache() {
    if (!this.cacheTimestamp || !this.pool || this.pool.length === 0) return;
    try {
      fs.writeFileSync(this.cacheFilePath, JSON.stringify({
        timestamp: this.cacheTimestamp,
        activeId: this.activeId,
        clientIds: this.pool
      }, null, 2), 'utf8');
    } catch (err) {}
  }

  async getClientId(options = {}) {
    if (options.forceRefresh) {
      await this.refreshPool(options);
      return this.activeId;
    }
    if (this.activeId && this.pool.length > 0) return this.activeId;
    if (this.loadDiskCache() && this.activeId) return this.activeId;

    await this.refreshPool(options);
    return this.activeId;
  }

  async refreshPool(options = {}) {
    if (this.refreshPromise) return await this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const proxy = options.proxy !== undefined ? options.proxy : this.proxy;
        const userAgent = options.userAgent || this.userAgent;
        const scrapedCandidates = await scrapeFreshClientIds({ proxy, userAgent });
        const candidates = Array.from(new Set([...scrapedCandidates, ...this.fallbackClientIds]));
        const validPool = [];

        for (let i = 0; i < candidates.length; i += 5) {
          const chunk = candidates.slice(i, i + 5);
          const results = await Promise.all(
            chunk.map(async (id) => (await validateClientId(id, { proxy, userAgent })) ? id : null)
          );
          results.forEach(id => { if (id) validPool.push(id); });
          if (validPool.length >= 3) break;
        }

        if (validPool.length === 0) {
          this.pool = [...this.fallbackClientIds];
          this.activeId = this.fallbackClientIds[0];
        } else {
          this.pool = validPool;
          this.activeId = validPool[0];
          this.cacheTimestamp = Date.now();
          this.saveDiskCache();
        }
        return this.pool;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return await this.refreshPromise;
  }

  async invalidateClientId(failedId) {
    if (!failedId) return this.activeId;
    this.pool = this.pool.filter(id => id !== failedId);
    if (this.activeId === failedId) {
      this.activeId = this.pool.length > 0 ? this.pool[0] : null;
    }
    this.saveDiskCache();

    if (this.pool.length === 0) {
      this.refreshPool().catch(() => {});
      this.activeId = this.fallbackClientIds[0];
    }
    return this.activeId;
  }
}

let defaultClientIdManager = null;
function getClientIdManager(options = {}) {
  if (!defaultClientIdManager || options.forceNew) {
    defaultClientIdManager = new ClientIdManager(options);
  }
  return defaultClientIdManager;
}

function getTranscodingScore(t) {
  if (!t) return -1;
  let score = 0;
  const preset = t.preset || '';
  const protocol = t.format?.protocol || '';
  const quality = t.quality || '';

  if (preset.includes('256k') || (preset.includes('aac') && (quality === 'high' || quality === 'hq'))) {
    score += 4000;
  } else if (preset.includes('160k') || preset.includes('opus')) {
    score += 3000;
  } else if (preset.includes('mp3_128_hq')) {
    score += 2000;
  } else if (preset.includes('mp3_128_sq')) {
    score += 1000;
  } else if (preset.includes('aac')) {
    score += 800;
  } else if (preset.includes('mp3')) {
    score += 600;
  } else {
    score += 100;
  }

  if (protocol === 'progressive') score += 50;
  if (quality === 'high' || quality === 'hq') score += 10;
  return score;
}

function selectBestTranscoding(transcodings) {
  if (!Array.isArray(transcodings) || transcodings.length === 0) return null;
  const sorted = [...transcodings].sort((a, b) => getTranscodingScore(b) - getTranscodingScore(a));
  return sorted[0];
}

function getFormatName(transcoding) {
  if (!transcoding) return 'unknown';
  const preset = transcoding.preset || '';
  const quality = transcoding.quality || '';
  if (preset.includes('256k') || (preset.includes('aac') && (quality === 'high' || quality === 'hq'))) return 'AAC 256k';
  if (preset.includes('160k')) return 'AAC 160k';
  if (preset.includes('opus')) return 'Opus 160k';
  if (preset.includes('mp3_128_hq')) return 'MP3 128k HQ';
  if (preset.includes('mp3_128_sq')) return 'MP3 128k SQ';
  if (preset.includes('aac')) return 'AAC';
  if (preset.includes('mp3')) return 'MP3 128k';
  return preset || 'unknown';
}

function getBitrate(transcoding) {
  if (!transcoding) return '128k';
  const preset = transcoding.preset || '';
  const quality = transcoding.quality || '';
  if (preset.includes('256k') || (preset.includes('aac') && (quality === 'high' || quality === 'hq'))) return '256k';
  if (preset.includes('160k') || preset.includes('opus')) return '160k';
  if (preset.includes('96k')) return '96k';
  if (preset.includes('128k')) return '128k';
  if (preset.includes('aac')) return '160k';
  return '128k';
}

class SoundCloudExtractor {
  constructor(options = {}) {
    this.clientIdManager = options.clientIdManager || getClientIdManager(options);
    this.userAgent = options.userAgent || DEFAULT_MOBILE_USER_AGENT;
    this.clientType = options.clientType || DEFAULT_CLIENT_TYPE;
    this.appVersion = options.appVersion || DEFAULT_APP_VERSION;
    this.maxRetries = options.maxRetries || 3;
    this.proxy = options.proxy;
  }

  async extractTrackStream(trackUrl, options = {}) {
    if (!trackUrl || typeof trackUrl !== 'string' || !trackUrl.trim()) {
      throw new Error(`Invalid SoundCloud track URL: ${trackUrl}`);
    }

    const maxRetries = options.maxRetries || this.maxRetries;
    const clientType = options.clientType || this.clientType;
    const appVersion = options.appVersion || this.appVersion;
    const fetchOptions = {
      proxy: options.proxy !== undefined ? options.proxy : this.proxy,
      userAgent: options.userAgent || this.userAgent,
      signal: options.signal
    };

    let attempts = 0;
    let lastError = null;

    while (attempts < maxRetries) {
      attempts++;
      let clientId = options.clientId || await this.clientIdManager.getClientId(fetchOptions);

      try {
        let resolveUrl;
        if (/^\d+$/.test(trackUrl.trim())) {
          resolveUrl = `https://api-v2.soundcloud.com/tracks/${trackUrl.trim()}?client_id=${clientId}&client_type=${clientType}&app_version=${appVersion}&app_locale=en`;
        } else if (trackUrl.includes('api.soundcloud.com/tracks/')) {
          const trackId = trackUrl.split('tracks/')[1]?.split('?')[0]?.split('/')[0];
          resolveUrl = `https://api-v2.soundcloud.com/tracks/${trackId}?client_id=${clientId}&client_type=${clientType}&app_version=${appVersion}&app_locale=en`;
        } else {
          resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(trackUrl)}&client_id=${clientId}&client_type=${clientType}&app_version=${appVersion}&app_locale=en`;
        }
        const resolveRes = await makeFetch(resolveUrl, {
          headers: {
            'User-Agent': fetchOptions.userAgent,
            'Accept': 'application/json',
            'X-SoundCloud-Client-Type': clientType,
            'X-SoundCloud-App-Version': appVersion
          },
          proxy: fetchOptions.proxy,
          signal: fetchOptions.signal
        });

        if (resolveRes.status === 401 || resolveRes.status === 403) {
          await this.clientIdManager.invalidateClientId(clientId);
          if (options.clientId) delete options.clientId;
          continue;
        }

        if (!resolveRes.ok) {
          throw new Error(`SoundCloud API error resolving track metadata: HTTP ${resolveRes.status}`);
        }

        const trackData = await resolveRes.json();
        if (!trackData || (!trackData.id && !trackData.media)) {
          throw new Error(`Invalid or non-existent track URL: ${trackUrl}`);
        }

        const transcodings = trackData.media?.transcodings || [];
        if (transcodings.length === 0) {
          throw new Error(`No stream transcodings found for track: ${trackUrl}`);
        }

        const selectedTranscoding = selectBestTranscoding(transcodings);
        if (!selectedTranscoding || !selectedTranscoding.url) {
          throw new Error(`Failed to select a valid stream transcoding for track: ${trackUrl}`);
        }

        const mediaApiUrl = selectedTranscoding.url.includes('?')
          ? `${selectedTranscoding.url}&client_id=${clientId}&client_type=${clientType}&app_version=${appVersion}`
          : `${selectedTranscoding.url}?client_id=${clientId}&client_type=${clientType}&app_version=${appVersion}`;

        const mediaRes = await makeFetch(mediaApiUrl, {
          headers: {
            'User-Agent': fetchOptions.userAgent,
            'Accept': 'application/json, */*',
            'X-SoundCloud-Client-Type': clientType,
            'X-SoundCloud-App-Version': appVersion
          },
          proxy: fetchOptions.proxy,
          signal: fetchOptions.signal
        });

        if (mediaRes.status === 401 || mediaRes.status === 403) {
          await this.clientIdManager.invalidateClientId(clientId);
          if (options.clientId) delete options.clientId;
          continue;
        }

        if (!mediaRes.ok) {
          throw new Error(`Failed to resolve direct media URL: HTTP ${mediaRes.status}`);
        }

        const mediaData = await mediaRes.json();
        if (!mediaData || !mediaData.url) {
          throw new Error(`SoundCloud media URL endpoint did not return a valid stream URL`);
        }

        return {
          streamUrl: mediaData.url,
          track: {
            id: trackData.id,
            title: trackData.title,
            duration: trackData.duration,
            permalink_url: trackData.permalink_url,
            artwork_url: trackData.artwork_url,
            user: {
              id: trackData.user?.id,
              username: trackData.user?.username,
              avatar_url: trackData.user?.avatar_url
            }
          },
          selectedTranscoding,
          format: getFormatName(selectedTranscoding),
          protocol: selectedTranscoding.format?.protocol || 'unknown',
          bitrate: getBitrate(selectedTranscoding),
          clientId
        };

      } catch (err) {
        lastError = err;
        if (err.message?.includes('401') || err.message?.includes('403')) {
          await this.clientIdManager.invalidateClientId(clientId);
          if (options.clientId) delete options.clientId;
        } else {
          throw err;
        }
      }
    }

    throw lastError || new Error(`Failed to extract track stream after ${maxRetries} attempts`);
  }
}

async function extractTrackStream(trackUrl, options = {}) {
  const extractor = new SoundCloudExtractor(options);
  return await extractor.extractTrackStream(trackUrl, options);
}

module.exports = {
  ClientIdManager,
  SoundCloudExtractor,
  extractTrackStream,
  getClientIdManager,
  scrapeFreshClientIds,
  validateClientId,
  selectBestTranscoding,
  FALLBACK_CLIENT_IDS
};
