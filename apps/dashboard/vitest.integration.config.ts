import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(__dirname, 'src')

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/integration.test.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      '~': srcDir,
      '@': srcDir,
    },
  },
})
