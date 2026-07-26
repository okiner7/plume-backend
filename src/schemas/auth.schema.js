const { z } = require('zod')

const telegramAuthSchema = z.object({
  id: z.union([z.number(), z.string()]),
  hash: z.string(),
  auth_date: z.union([z.number(), z.string()]).optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional()
}).strict()

const verifyCodeSchema = z.object({
  code: z.string().min(1)
}).strict()

module.exports = {
  telegramAuthSchema,
  verifyCodeSchema
}
