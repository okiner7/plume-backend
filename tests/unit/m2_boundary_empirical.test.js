const { formatTrack } = require('../../src/services/soundcloud/formatters');
const { getTranscodingScore, selectBestTranscoding } = require('../../src/utils/lunex-sc');
const { selectBestAudioFormat } = require('../../src/utils/lunex-ytdl');

describe('Milestone 2 Empirical Boundary & Stress Tests', () => {
  describe('1. YouTube Audio Format Selection Boundary Conditions', () => {
    it('1a. Selects 256k AAC (itag 141) when 256k AAC, 160k Opus, and 128k AAC are available', () => {
      const formats = [
        { itag: 140, bitrate: 128000, mimeType: 'audio/mp4; codecs="mp4a.40.2"', audioQuality: 'AUDIO_QUALITY_MEDIUM' },
        { itag: 251, bitrate: 160000, mimeType: 'audio/webm; codecs="opus"', audioQuality: 'AUDIO_QUALITY_HIGH' },
        { itag: 141, bitrate: 256000, mimeType: 'audio/mp4; codecs="mp4a.40.2"', audioQuality: 'AUDIO_QUALITY_HIGH' }
      ];
      const selected = selectBestAudioFormat(formats);
      expect(selected).not.toBeNull();
      expect(selected.itag).toBe(141);
      expect(selected.bitrate).toBe(256000);
    });

    it('1b. Falls back to 160k Opus (itag 251) when 256k AAC is MISSING', () => {
      const formats = [
        { itag: 140, bitrate: 128000, mimeType: 'audio/mp4; codecs="mp4a.40.2"', audioQuality: 'AUDIO_QUALITY_MEDIUM' },
        { itag: 251, bitrate: 160000, mimeType: 'audio/webm; codecs="opus"', audioQuality: 'AUDIO_QUALITY_HIGH' },
        { itag: 250, bitrate: 70000, mimeType: 'audio/webm; codecs="opus"', audioQuality: 'AUDIO_QUALITY_LOW' }
      ];
      const selected = selectBestAudioFormat(formats);
      expect(selected).not.toBeNull();
      expect(selected.itag).toBe(251);
      expect(selected.bitrate).toBe(160000);
    });

    it('1c. Falls back to 128k AAC (itag 140) when 256k AAC and 160k Opus are MISSING', () => {
      const formats = [
        { itag: 140, bitrate: 128000, mimeType: 'audio/mp4; codecs="mp4a.40.2"', audioQuality: 'AUDIO_QUALITY_MEDIUM' },
        { itag: 250, bitrate: 70000, mimeType: 'audio/webm; codecs="opus"', audioQuality: 'AUDIO_QUALITY_LOW' },
        { itag: 249, bitrate: 50000, mimeType: 'audio/webm; codecs="opus"', audioQuality: 'AUDIO_QUALITY_LOW' }
      ];
      const selected = selectBestAudioFormat(formats);
      expect(selected).not.toBeNull();
      expect(selected.itag).toBe(140);
      expect(selected.bitrate).toBe(128000);
    });

    it('1d. Falls back to lowest quality (itag 249, 50k) when only low quality formats exist', () => {
      const formats = [
        { itag: 249, bitrate: 50000, mimeType: 'audio/webm; codecs="opus"', audioQuality: 'AUDIO_QUALITY_LOW' }
      ];
      const selected = selectBestAudioFormat(formats);
      expect(selected).not.toBeNull();
      expect(selected.itag).toBe(249);
      expect(selected.bitrate).toBe(50000);
    });

    it('1e. Handles arrays with null, undefined, or missing mimeType gracefully', () => {
      const formats = [
        null,
        undefined,
        { width: 1920, height: 1080, mimeType: 'video/mp4' },
        { itag: 140, bitrate: 128000, mimeType: 'audio/mp4; codecs="mp4a.40.2"' }
      ];
      const selected = selectBestAudioFormat(formats);
      expect(selected).not.toBeNull();
      expect(selected.itag).toBe(140);
    });

    it('1f. Returns null for empty array, null, or non-array inputs', () => {
      expect(selectBestAudioFormat([])).toBeNull();
      expect(selectBestAudioFormat(null)).toBeNull();
      expect(selectBestAudioFormat(undefined)).toBeNull();
      expect(selectBestAudioFormat('invalid')).toBeNull();
    });
  });

  describe('2. SoundCloud Transcoding Scoring Boundary Conditions', () => {
    it('2a. Ranks aac_256k > opus_160k > mp3_128_hq > mp3_128', () => {
      const aac256 = { preset: 'aac_256k', format: { protocol: 'hls' }, quality: 'high' };
      const opus160 = { preset: 'opus_160k', format: { protocol: 'hls' }, quality: 'sq' };
      const mp3128hq = { preset: 'mp3_128_hq', format: { protocol: 'hls' }, quality: 'sq' };
      const mp3128 = { preset: 'mp3_128', format: { protocol: 'progressive' }, quality: 'sq' };

      expect(getTranscodingScore(aac256)).toBeGreaterThan(getTranscodingScore(opus160));
      expect(getTranscodingScore(opus160)).toBeGreaterThan(getTranscodingScore(mp3128hq));
      expect(getTranscodingScore(mp3128hq)).toBeGreaterThan(getTranscodingScore(mp3128));
    });

    it('2b. Falls back to opus_160k when 256k AAC is missing', () => {
      const opus160 = { preset: 'opus_160k', format: { protocol: 'hls' }, quality: 'sq' };
      const mp3128 = { preset: 'mp3_128', format: { protocol: 'progressive' }, quality: 'sq' };

      const best = selectBestTranscoding([mp3128, opus160]);
      expect(best.preset).toBe('opus_160k');
    });

    it('2c. Falls back to mp3_128 progressive when no HQ streams exist', () => {
      const mp3128 = { preset: 'mp3_128', format: { protocol: 'progressive' }, quality: 'sq' };
      const best = selectBestTranscoding([mp3128]);
      expect(best.preset).toBe('mp3_128');
    });

    it('2d. Returns null for empty, null, or invalid transcoding lists', () => {
      expect(selectBestTranscoding([])).toBeNull();
      expect(selectBestTranscoding(null)).toBeNull();
      expect(selectBestTranscoding(undefined)).toBeNull();
    });
  });

  describe('3. SoundCloud Formatters (formatTrack) Fallback Logic', () => {
    it('3a. Prefers HLS protocol stream_url when available', () => {
      const track = {
        id: 1,
        title: 'HLS Track',
        media: {
          transcodings: [
            { format: { protocol: 'progressive' }, url: 'https://api-sc.com/prog' },
            { format: { protocol: 'hls' }, url: 'https://api-sc.com/hls' }
          ]
        }
      };
      const formatted = formatTrack(track);
      expect(formatted.stream_url).toBe('https://api-sc.com/hls');
    });

    it('3b. Falls back to progressive protocol when HLS is missing', () => {
      const track = {
        id: 2,
        title: 'Prog Track',
        media: {
          transcodings: [
            { format: { protocol: 'progressive' }, url: 'https://api-sc.com/prog' }
          ]
        }
      };
      const formatted = formatTrack(track);
      expect(formatted.stream_url).toBe('https://api-sc.com/prog');
    });

    it('3c. Falls back to transcodings[0].url if format protocol is missing or unlisted', () => {
      const track = {
        id: 3,
        title: 'Custom Protocol Track',
        media: {
          transcodings: [
            { format: { protocol: 'custom_rtmp' }, url: 'https://api-sc.com/custom' }
          ]
        }
      };
      const formatted = formatTrack(track);
      expect(formatted.stream_url).toBe('https://api-sc.com/custom');
    });

    it('3d. Handles missing media, missing transcodings, or null input without crashing', () => {
      expect(formatTrack(null)).toBeNull();
      expect(formatTrack({ id: 4, title: 'No Media' }).stream_url).toBeNull();
      expect(formatTrack({ id: 5, title: 'Empty Media', media: {} }).stream_url).toBeNull();
      expect(formatTrack({ id: 6, title: 'Empty Transcodings', media: { transcodings: [] } }).stream_url).toBeNull();
    });
  });
});
