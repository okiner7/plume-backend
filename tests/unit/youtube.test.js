const { normaliseTrack, shuffleBiased } = require('../../services/youtube/search');

describe('YouTube Search Utilities', () => {
  it('should normalise a track object correctly', () => {
    const rawTrack = {
      videoId: 'test_vid_1',
      title: 'Never Gonna Give You Up',
      artists: [{ name: 'Rick Astley', id: 'rick_1' }],
      duration: 213, // seconds
      thumbnails: [{ url: 'small.jpg' }, { url: 'large.jpg' }]
    };

    const formatted = normaliseTrack(rawTrack);
    expect(formatted.id).toBe('test_vid_1');
    expect(formatted.title).toBe('Never Gonna Give You Up');
    expect(formatted.artist).toBe('Rick Astley');
    expect(formatted.duration).toBe(213000); // Should be converted to ms
    expect(formatted.artwork).toBe('large.jpg');
    expect(formatted.url).toBe('https://music.youtube.com/watch?v=test_vid_1');
  });

  it('should normalise a track with missing artist data', () => {
    const rawTrack = {
      videoId: 'test_vid_2',
      name: 'Unknown Track', // YT sometimes returns name instead of title
      author: { name: 'Some Author' }
    };

    const formatted = normaliseTrack(rawTrack);
    expect(formatted.title).toBe('Unknown Track');
    expect(formatted.artist).toBe('Some Author');
    expect(formatted.artwork).toBeNull();
  });

  it('should bias shuffle arrays', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffleBiased(arr);
    
    expect(shuffled.length).toBe(arr.length);
    // Elements should be the same, just order changed
    expect(shuffled).toEqual(expect.arrayContaining(arr));
  });
});
