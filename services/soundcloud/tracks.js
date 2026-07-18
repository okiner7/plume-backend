const { request, fetchAll } = require('./client')
const { formatTrack } = require('./formatters')

async function getUserTracksById(id) {
  // Лимитируем до 50 треков (максимум 1-2 запроса), чтобы не парсить 1000 треков
  const collection = await fetchAll(`/users/${id}/tracks?limit=50`, 50)
  return collection.map(formatTrack).filter(t => t !== null)
}

async function getPlaylistTracks(playlistIdOrUrl) {
  try {
    let data
    const isUrl = String(playlistIdOrUrl).includes('soundcloud.com')
    if (isUrl) {
      const cleanUrl = decodeURIComponent(playlistIdOrUrl).split('?')[0]
      data = await request('/resolve', { url: cleanUrl })
    } else {
      data = await request(`/playlists/${playlistIdOrUrl}`)
    }
    if (!data || !data.id) throw new Error('Playlist not found')

    const allTrackIds = data.tracks ? data.tracks.map(t => t.id) : []
    if (allTrackIds.length === 0) return []

    let fullTracks = []
    try {
      const trackIdsString = allTrackIds.slice(0, 50).join(',')
      const response = await request('/tracks', { ids: trackIdsString })
      fullTracks = Array.isArray(response) ? response : (response.collection || [])
    } catch {
      fullTracks = data.tracks
    }

    return fullTracks.map(formatTrack).filter(t => t !== null && t.title !== 'Untitled Track')
  } catch (error) {
    console.error('SC_PLAYLIST_ERROR:', error.message)
    return []
  }
}
async function getRelatedTracks(trackId) {
  try {
    const data = await request(`/tracks/${trackId}/related`)
    if (!data || !data.collection) return []
    return data.collection.map(formatTrack).filter(t => t !== null && t.title !== 'Untitled Track')
  } catch (error) {
    console.error('SC_RELATED_ERROR:', error.message)
    return []
  }
}

async function searchTracksByArtist(artistName, limit = 50) {
  try {
    const { request } = require('./client')
    const { formatTrack } = require('./formatters')
    const encoded = encodeURIComponent(artistName)
    // Делаем ровно 1 запрос (limit=50) вместо пагинации до 1000 треков
    const data = await request(`/search/tracks?q=${encoded}&limit=${limit}`)
    const collection = data.collection || (Array.isArray(data) ? data : [])
    return collection.map(formatTrack).filter(t => t !== null && t.title !== 'Untitled Track')
  } catch (error) {
    console.error('SC_ARTIST_SEARCH_ERROR:', error.message)
    return []
  }
}

module.exports = { getUserTracksById, getPlaylistTracks, getRelatedTracks, searchTracksByArtist }
