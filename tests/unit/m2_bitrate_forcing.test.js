const { formatTrack } = require('../../src/services/soundcloud/formatters');
const { getTranscodingScore, selectBestTranscoding } = require('../../src/utils/lunex-sc');
const { selectBestAudioFormat } = require('../../src/utils/lunex-ytdl');
const request = require('supertest');
const crypto = require('crypto');
const app = require('../../src/server');

describe('Milestone 2 Maximum Bitrate Forcing (256k AAC/Opus)', () => {
  describe('1. SoundCloud Formatters & Transcoding Scoring', () => {
    it('prioritizes HLS protocol over progressive protocol in formatTrack', () => {
      const track = {
        id: 101,
        title: 'HQ SC Track',
        user: { username: 'HQ Artist' },
        media: {
          transcodings: [
            { format: { protocol: 'progressive' }, url: 'https://cdn.soundcloud.com/prog128.mp3' },
            { format: { protocol: 'hls' }, url: 'https://cdn.soundcloud.com/hq256.m3u8' }
          ]
        }
      };
      const formatted = formatTrack(track);
      expect(formatted.stream_url).toBe('https://cdn.soundcloud.com/hq256.m3u8');
    });

    it('ranks aac_256k highest (100+), opus_160k (90+), and mp3_128 (50)', () => {
      const aac256 = { preset: 'aac_256k', format: { protocol: 'hls' }, quality: 'high' };
      const opus160 = { preset: 'opus_160k', format: { protocol: 'hls' }, quality: 'sq' };
      const mp3128 = { preset: 'mp3_128', format: { protocol: 'progressive' }, quality: 'sq' };

      expect(getTranscodingScore(aac256)).toBeGreaterThanOrEqual(100);
      expect(getTranscodingScore(opus160)).toBeGreaterThanOrEqual(90);
      expect(getTranscodingScore(mp3128)).toBe(50);

      const best = selectBestTranscoding([mp3128, opus160, aac256]);
      expect(best.preset).toBe('aac_256k');
    });
  });

  describe('2. YouTube Audio Format Selection', () => {
    it('selects 256k AAC (itag 141) / 160k Opus (itag 251) over 128k (itag 140)', () => {
      const formats = [
        { itag: 140, bitrate: 128000, mimeType: 'audio/mp4; codecs="mp4a.40.2"', audioQuality: 'AUDIO_QUALITY_MEDIUM' },
        { itag: 251, bitrate: 160000, mimeType: 'audio/webm; codecs="opus"', audioQuality: 'AUDIO_QUALITY_HIGH' },
        { itag: 141, bitrate: 256000, mimeType: 'audio/mp4; codecs="mp4a.40.2"', audioQuality: 'AUDIO_QUALITY_HIGH' }
      ];

      const best = selectBestAudioFormat(formats);
      expect(best.itag).toBe(141);
      expect(best.bitrate).toBe(256000);
    });
  });

  describe('3. Stream Response Quality Headers (X-Audio-Bitrate & X-Audio-Codec)', () => {
    const APP_SECRET = process.env.LUNEX_APP_SECRET || 'super-secret-lunex-app-key-2026';
    const lunexYtdl = require('../../src/utils/lunex-ytdl');

    it('transmits X-Audio-Bitrate and X-Audio-Codec on YouTube stream response', async () => {
      const t = Date.now().toString();
      const sig = crypto.createHmac('sha256', APP_SECRET)
                        .update('/api/yt/stream' + t)
                        .digest('hex');

      jest.spyOn(lunexYtdl, 'getStreamUrl').mockResolvedValue({
        url: 'https://googlevideo.com/videoplayback?id=hq_vid',
        bitrate: 256000,
        codec: 'aac'
      });

      const mockData = Buffer.from('hq audio chunk');
      const mockHeaders = new Map([
        ['content-type', 'audio/mp4'],
        ['content-length', mockData.length.toString()]
      ]);

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('googlevideo.com')) {
          const mockBody = new (require('stream').PassThrough)();
          process.nextTick(() => mockBody.end(mockData));
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: (n) => mockHeaders.get(n.toLowerCase()) || null },
            body: mockBody
          });
        }
        return originalFetch(url);
      });

      try {
        const res = await request(app).get(`/api/yt/stream?id=hq_vid&t=${t}&sig=${sig}`);
        expect(res.status).toBe(200);
        expect(res.headers['x-audio-bitrate']).toBe('256');
        expect(res.headers['x-audio-codec']).toBe('aac');
      } finally {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
      }
    });
  });
});
