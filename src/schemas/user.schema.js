const { z } = require('zod')

const trackSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  source: z.string().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  duration: z.number().optional(),
  artwork: z.string().optional(),
  url: z.string().optional()
})

const likeTrackSchema = z.object({
  trackId: z.union([z.string(), z.number()]).optional(),
  track: trackSchema.optional()
}).refine(data => data.trackId !== undefined || data.track !== undefined, {
  message: 'trackId or track required'
})

const createPlaylistSchema = z.object({
  name: z.string().min(1)
})

const updatePlaylistSchema = z.object({
  name: z.string().min(1)
})

const addTrackSchema = z.object({
  trackId: z.union([z.string(), z.number()]).optional(),
  track: trackSchema.optional()
}).refine(data => data.trackId !== undefined || data.track !== undefined, {
  message: 'trackId or track required'
})

const updateSettingsSchema = z.object({
  theme: z.string().optional(),
  accent: z.string().optional(),
  customThemeData: z.record(z.any()).optional()
})

const searchHistorySchema = z.object({
  query: z.string().min(1)
})

const listeningHistorySchema = z.object({
  trackId: z.union([z.string(), z.number()]).optional(),
  duration: z.number().optional(),
  playedAt: z.union([z.string(), z.number()]).optional(),
  track: trackSchema.optional()
}).refine(data => data.trackId !== undefined || data.track !== undefined || data.duration !== undefined, {
  message: 'Track data required'
})

module.exports = {
  trackSchema,
  likeTrackSchema,
  createPlaylistSchema,
  updatePlaylistSchema,
  addTrackSchema,
  updateSettingsSchema,
  searchHistorySchema,
  listeningHistorySchema,
  // Aliases for compatibility
  postLikesSchema: likeTrackSchema,
  postPlaylistsSchema: createPlaylistSchema,
  putPlaylistSchema: updatePlaylistSchema,
  postPlaylistTrackSchema: addTrackSchema,
  putSettingsSchema: updateSettingsSchema,
  postSearchHistorySchema: searchHistorySchema,
  postListeningHistorySchema: listeningHistorySchema
}
