const { ytmusic, init, safeArray } = require('./client')

async function search(q) {
  await init()
  const results = await ytmusic.searchSongs(q).catch(() => null)
  if (!results || !results.length) return []

  return results.filter(t => t.videoId).map(t => {
    let finalArtists = []
    if (Array.isArray(t.artists) && t.artists.length > 0) {
      finalArtists = t.artists.map(a => ({ name: a.name || a.text, id: a.artistId || a.id || null }))
    } else if (t.artist) {
      const a = t.artist
      finalArtists.push({ name: a.name || a.text || (typeof a === 'string' ? a : 'Unknown'), id: a.artistId || a.id || null })
    } else if (t.author) {
      finalArtists.push({ name: t.author.name || t.author.text || 'Unknown', id: t.author.browseId || null })
    }

    const cleanArtists = finalArtists.filter(a => a.name && a.name !== 'Unknown')
    return {
      id: t.videoId,
      source: 'youtube',
      title: t.name,
      artists: cleanArtists.length > 0 ? cleanArtists : [{ name: 'Unknown', id: null }],
      duration: (t.duration || 0) * 1000,
      artwork: t.thumbnails?.at(-1)?.url || null,
      isExplicit: t.isExplicit || false,
      url: `https://music.youtube.com/watch?v=${t.videoId}`
    }
  })
}

async function searchArtists(q) {
  await init()
  const results = await ytmusic.searchArtists(q).catch(() => null)
  return safeArray(results)
    .filter(a => a.artistId)
    .map(a => ({
      id: a.artistId,
      source: 'youtube',
      itemType: 'artist',
      title: a.name,
      artist: a.name, // Display artist name in subtitle
      artwork: a.thumbnails?.at(-1)?.url || null,
      url: `https://music.youtube.com/channel/${a.artistId}`
    }))
}

async function searchPlaylists(q) {
  await init()
  const results = await ytmusic.searchPlaylists(q).catch(() => null)
  return safeArray(results)
    .filter(p => p.playlistId)
    .map(p => ({
      id: p.playlistId,
      source: 'youtube',
      itemType: 'playlist',
      title: p.name,
      artist: p.author || 'YouTube Playlist', // Subtitle
      artwork: p.thumbnails?.at(-1)?.url || null,
      url: `https://music.youtube.com/playlist?list=${p.playlistId}`
    }))
}

// ── My Wave Rotation Algorithm ────────────────────────────────────────────────
// Instead of just calling getUpNexts(currentId) once, we:
// 1. Gather candidates from the current track AND a random subset of the history
// 2. Deduplicate and filter tracks we've already seen
// 3. Shuffle the pool with a biased Fisher-Yates (earlier seeds get slight weight boost)
// 4. Return a slice of the best candidates
// This makes the queue feel alive and non-repetitive.

function shuffleBiased(arr) {
  // Fisher-Yates with a slight front-bias so fresher seeds appear sooner
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    // Bias: items near the start are slightly more likely to stay near the start
    const bias = Math.floor(Math.random() * Math.random() * (i + 1))
    ;[a[i], a[bias]] = [a[bias], a[i]]
  }
  return a
}

function normaliseTrack(t) {
  let artistName = 'Unknown'
  let artistId = null

  if (typeof t.artists === 'string' && t.artists) {
    // getUpNexts returns artists as a plain string
    artistName = t.artists
  } else if (Array.isArray(t.artists) && t.artists.length > 0) {
    artistName = t.artists[0].name || t.artists[0].text || 'Unknown'
    artistId = t.artists[0].artistId || t.artists[0].id || null
  } else if (t.artists?.name || t.artists?.text) {
    artistName = t.artists.name || t.artists.text
    artistId = t.artists.artistId || t.artists.id || null
  } else if (t.author) {
    artistName = t.author.name || 'Unknown'
    artistId = t.author.id || null
  }

  // Try every possible thumbnail field name
  const thumbs = t.thumbnails || t.thumbnail || t.cover || []
  const artworkUrl = Array.isArray(thumbs)
    ? (thumbs.at(-1)?.url || thumbs[0]?.url || null)
    : (typeof thumbs === 'string' ? thumbs : thumbs?.url || null)

  return {
    id: t.videoId,
    source: 'youtube',
    title: t.title || t.name,
    artists: [{ name: artistName, id: artistId }],
    artist: artistName,
    duration: (t.duration || 0) * 1000,
    artwork: artworkUrl,
    url: `https://music.youtube.com/watch?v=${t.videoId}`
  }
}

async function getUpNexts(videoId, historyIds = []) {
  await init()

  // Seeds: current video + up to 3 random tracks from history
  const historySample = historyIds.length > 0
    ? historyIds
        .slice()
        .sort(() => Math.random() - 0.5)
        .slice(0, 3)
    : []

  const seeds = [videoId, ...historySample]

  // Fetch candidates from all seeds in parallel
  const fetched = await Promise.allSettled(
    seeds.map(id => ytmusic.getUpNexts(id).catch(() => null))
  )

  const seenIds = new Set([...seeds, ...historyIds])
  const pool = []

  for (const result of fetched) {
    if (result.status !== 'fulfilled' || !result.value) continue
    for (const t of safeArray(result.value)) {
      if (!t.videoId || seenIds.has(t.videoId)) continue
      seenIds.add(t.videoId)
      pool.push(normaliseTrack(t))
    }
  }

  // Shuffle with bias and return up to 15 tracks
  return shuffleBiased(pool).slice(0, 15)
}
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { search, searchArtists, searchPlaylists, getUpNexts, normaliseTrack, shuffleBiased }
