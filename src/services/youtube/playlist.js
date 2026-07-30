const { ytmusic, init, safeArray } = require('./client')

async function getPlaylist(id) {
  await init()
  return await ytmusic.getPlaylist(id).catch(() => null)
}

async function getPlaylistTracks(id) {
  await init()
  const tracks = await ytmusic.getPlaylistVideos(id).catch(() => null)
  return safeArray(tracks).map(t => {
    const videoId = t.videoId || t.id
    const artistName = t.artist?.name || (Array.isArray(t.artists) ? t.artists.map(a => a.name).join(', ') : (typeof t.artist === 'string' ? t.artist : (t.author?.name || 'Unknown Artist')))
    const artistId = t.artist?.artistId || t.artist?.id || (Array.isArray(t.artists) ? t.artists[0]?.id || t.artists[0]?.artistId : undefined)
    const artworkUrl = t.thumbnails?.at(-1)?.url || null

    return {
      id: videoId,
      videoId: videoId,
      source: 'youtube',
      title: t.name || t.title || 'Untitled Track',
      artist: artistName,
      artistId: artistId,
      duration: (t.duration || 0) * 1000,
      artwork: artworkUrl,
      thumbnail: artworkUrl,
      url: `https://music.youtube.com/watch?v=${videoId}`
    }
  })
}

module.exports = { getPlaylist, getPlaylistTracks }
