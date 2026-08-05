function formatTrack(t) {
  if (!t) return null
  if (!t.title && t.id && !t.user) return null

  const artistName = t.user?.username || t.username || (t.publisher_metadata?.artist) || 'SoundCloud Artist'
  let artwork = t.artwork_url || t.user?.avatar_url || 'https://via.placeholder.com/500x500?text=No+Cover'
  artwork = artwork.replace('-large', '-t500x500')

  return {
    id: t.id,
    source: 'soundcloud',
    title: t.title || 'Untitled Track',
    artist: artistName,
    duration: t.duration || 0,
    artwork,
    url: t.permalink_url,
    genre: t.genre || 'None',
    stream_url: t.media?.transcodings?.find(tr => tr.format?.protocol === 'hls')?.url ||
      t.media?.transcodings?.find(tr => tr.format?.protocol === 'progressive')?.url ||
      t.media?.transcodings?.[0]?.url || null
  }
}

function formatPlaylist(p) {
  if (!p) return null
  return {
    id: p.id,
    source: 'soundcloud',
    itemType: 'playlist',
    title: p.title || 'Untitled Playlist',
    artist: p.user?.username || 'Unknown Artist',
    track_count: p.track_count || 0,
    duration: p.duration || 0,
    artwork: (p.artwork_url || p.user?.avatar_url || '').replace('-large', '-t500x500'),
    url: p.permalink_url
  }
}

module.exports = { formatTrack, formatPlaylist }
