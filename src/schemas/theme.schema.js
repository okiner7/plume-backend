const { z } = require('zod')

const createThemeSchema = z.object({
  name: z.string().min(1),
  themeData: z.record(z.any())
}).strict()

const downloadThemeSchema = z.object({}).strict()

module.exports = {
  createThemeSchema,
  downloadThemeSchema,
  postThemeSchema: createThemeSchema
}
