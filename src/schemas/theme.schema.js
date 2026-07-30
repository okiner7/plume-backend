const { z } = require('zod')

const createThemeSchema = z.object({
  name: z.string().min(1).max(100),
  themeData: z.record(z.any()).refine(val => {
    try {
      return JSON.stringify(val).length <= 50000
    } catch {
      return false
    }
  }, { message: 'Theme data payload size exceeds limit (50KB)' })
}).strict()

const downloadThemeSchema = z.object({}).strict()

module.exports = {
  createThemeSchema,
  downloadThemeSchema,
  postThemeSchema: createThemeSchema
}
