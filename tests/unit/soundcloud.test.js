const { formatTrack, formatPlaylist } = require('../../services/soundcloud/formatters');

describe('SoundCloud Formatters', () => {
  it('should format a valid track object correctly', () => {
    const rawTrack = {
      id: 12345,
      title: 'Awesome Track',
      user: { username: 'DJ Foo' },
      duration: 180000,
      artwork_url: 'https://foo.com/art-large.jpg',
      permalink_url: 'https://soundcloud.com/djfoo/awesome-track',
      media: {
        transcodings: [
          { format: { protocol: 'hls' }, url: 'https://hls-url.com' },
          { format: { protocol: 'progressive' }, url: 'https://prog-url.com' }
        ]
      }
    };

    const formatted = formatTrack(rawTrack);
    expect(formatted).not.toBeNull();
    expect(formatted.title).toBe('Awesome Track');
    expect(formatted.artist).toBe('DJ Foo');
    // Ensure progressive is preferred over hls in formatter
    expect(formatted.stream_url).toBe('https://prog-url.com');
    // Ensure artwork size replaces correctly
    expect(formatted.artwork).toBe('https://foo.com/art-t500x500.jpg');
  });

  it('should return null for empty or invalid track', () => {
    expect(formatTrack(null)).toBeNull();
    expect(formatTrack({ id: 123 })).toBeNull(); // Missing title and user
  });

  it('should format playlist correctly', () => {
    const rawPlaylist = {
      id: 999,
      title: 'Summer Mix',
      user: { username: 'DJ Bar', avatar_url: 'https://bar.com/avatar-large.jpg' },
      track_count: 10,
      permalink_url: 'https://soundcloud.com/djbar/sets/summer-mix'
    };

    const formatted = formatPlaylist(rawPlaylist);
    expect(formatted.itemType).toBe('playlist');
    expect(formatted.title).toBe('Summer Mix');
    expect(formatted.artist).toBe('DJ Bar');
    expect(formatted.track_count).toBe(10);
    expect(formatted.artwork).toBe('https://bar.com/avatar-t500x500.jpg');
  });
});
