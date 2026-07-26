const { z } = require('zod')

const proxySchema = z.object({
  url: z.string().min(1)
}).strict()

const resetProxiesSchema = z.object({}).strict()

const banUserSchema = z.object({
  reason: z.string().optional()
}).strict()

const restartSchema = z.object({}).strict()

const updateSchema = z.object({
  version: z.string().min(1),
  platform: z.string().min(1),
  releaseNotes: z.string().optional(),
  mandatory: z.union([z.string(), z.boolean()]).optional(),
  channel: z.string().optional()
}).strict()

const rollbackSchema = z.object({}).strict()

module.exports = {
  proxySchema,
  resetProxiesSchema,
  banUserSchema,
  restartSchema,
  updateSchema,
  rollbackSchema,
  // Aliases for compatibility
  addProxySchema: proxySchema,
  postUpdateSchema: updateSchema,
  rollbackUpdateSchema: rollbackSchema
}
