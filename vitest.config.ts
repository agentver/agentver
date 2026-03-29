import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          environment: 'node',
          globals: true,
          include: ['src/**/*.test.ts'],
          exclude: ['dist/**', 'node_modules/**'],
        },
      },
      {
        test: {
          name: 'agent-definitions',
          root: './packages/agent-definitions',
          environment: 'node',
          globals: true,
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'cli',
          root: './packages/cli',
          environment: 'node',
          globals: true,
          include: ['src/**/*.test.ts'],
          exclude: ['src/__tests__/e2e/**'],
          testTimeout: 30_000,
        },
      },
    ],
  },
})
