import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'prisma/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env in development — dotenv is a devDependency so may not exist in production
try {
  const { config } = await import('dotenv')
  config({ path: resolve(__dirname, '../../.env') })
} catch {
  // Production: DATABASE_URL is injected by Cloud Run secrets
}

export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
  },

  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/placeholder',
  },
})
