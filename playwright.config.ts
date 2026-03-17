import { defineConfig, devices } from '@playwright/test'
import { AUTH_FILE } from './e2e/constants'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_FILE,
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: process.env.CI ? 'node apps/dashboard/.next/standalone/server.js' : 'bun run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: process.env.CI ? { PORT: '3001', HOSTNAME: '0.0.0.0' } : undefined,
  },
})
