import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/json-output.test.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
