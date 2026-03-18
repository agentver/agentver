import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(__dirname, 'src')

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'integration',
          globals: true,
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.unit.test.ts'],
          setupFiles: ['src/test/setup.ts'],
          testTimeout: 15_000,
          fileParallelism: false,
        },
        resolve: {
          alias: {
            '~': srcDir,
            '@': srcDir,
          },
        },
      },
      {
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['src/**/*.unit.test.ts'],
          testTimeout: 15_000,
        },
        resolve: {
          alias: {
            '~': srcDir,
            '@': srcDir,
          },
        },
      },
    ],
  },
})
