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
      if (data && data.id) {
        data = await request(`/playlists/${data.id}`, { representation: 'full' })
      }
    } else {
      data = await request(`/playlists/${playlistIdOrUrl}`, { representation: 'full' })
    }
    if (!data || !data.id) throw new Error('Playlist not found')

    const allTrackIds = data.tracks ? data.tracks.map(t => t.id) : []
    if (allTrackIds.length === 0) return []

    let fullTracks = []
    
    // Разбиваем на чанки по 50 треков
    for (let i = 0; i < allTrackIds.length; i += 50) {
      const chunk = allTrackIds.slice(i, i + 50)
      try {
        const response = await request('/tracks', { ids: chunk.join(',') })
        const fetched = Array.isArray(response) ? response : (response.collection || [])
        fullTracks = fullTracks.concat(fetched)
      } catch (err) {
        console.error('SC_PLAYLIST_CHUNK_ERROR:', err.message)
        // Если чанк упал, берем оригинальные треки из плейлиста для этого чанка
        const originalTracks = data.tracks.slice(i, i + 50)
        fullTracks = fullTracks.concat(originalTracks)
      }
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
