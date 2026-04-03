/**
 * Auth flow E2E tests — exercises login, whoami, and logout against a real
 * HTTP server using the built CLI binary. No mocks; all filesystem and network
 * operations are real.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WhoamiResult } from '@agentver/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTempDir, createTempDir } from '../helpers/mock-fs'
import {
  createMockPlatformServer,
  type MockPlatformServer,
  writeMockCredentials,
} from '../helpers/mock-server'
import { runCli, runCliJson } from './helpers'

// ---------------------------------------------------------------------------
// Shared server and temp directory
// ---------------------------------------------------------------------------

let server: MockPlatformServer
let tempHome: string

beforeAll(async () => {
  server = await createMockPlatformServer()
  tempHome = createTempDir()
})

afterAll(async () => {
  await server.close()
  cleanupTempDir(tempHome)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agentverDir(): string {
  return join(tempHome, '.agentver')
}

function credentialsPath(): string {
  return join(agentverDir(), 'credentials.json')
}

function configPath(): string {
  return join(agentverDir(), 'config.json')
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as T
}

// ---------------------------------------------------------------------------
// Full happy-path flow
// ---------------------------------------------------------------------------

describe('E2E: auth flow', () => {
  it('login --token writes credentials and config to disk', async () => {
    const result = await runCli(['login', server.url, '--token', 'test-token-123'], {
      cwd: tempHome,
      homeDir: tempHome,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Saved API key')
    expect(result.stdout).toContain(server.url)

    // Verify credentials file was written
    expect(existsSync(credentialsPath())).toBe(true)
    const credentials = readJsonFile<{ apiKey?: string; token?: string }>(credentialsPath())
    expect(credentials.apiKey).toBe('test-token-123')

    // Verify config file has the platform URL
    expect(existsSync(configPath())).toBe(true)
    const config = readJsonFile<{ platformUrl?: string }>(configPath())
    expect(config.platformUrl).toBe(server.url)
  })

  it('whoami --json returns authenticated user info from mock server', async () => {
    const { data, success, exitCode } = await runCliJson<WhoamiResult>(['whoami', '--json'], {
      cwd: tempHome,
      homeDir: tempHome,
    })

    expect(exitCode).toBe(0)
    expect(success).toBe(true)
    expect(data.authenticated).toBe(true)
    expect(data.platform).toBe(server.url)
    expect(data.user).toBeDefined()
    expect(data.user?.email).toBe('test@agentver.dev')
    expect(data.user?.name).toBe('Test User')
    expect(data.organisation).toContain('test-org')
  })

  it('mock server received the /me request with correct auth header', () => {
    const meRequests = server.getRequestsFor('GET', '/api/v1/me')
    expect(meRequests.length).toBeGreaterThanOrEqual(1)

    const lastMeRequest = meRequests[meRequests.length - 1]!
    expect(lastMeRequest.headers['x-api-key'] ?? lastMeRequest.headers.authorization).toBeDefined()
  })

  it('logout --yes clears credentials', async () => {
    const result = await runCli(['logout', '--yes'], { cwd: tempHome, homeDir: tempHome })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Logged out successfully')

    // Credentials file should be removed
    expect(existsSync(credentialsPath())).toBe(false)

    // Config file should still exist (logout does not remove it)
    expect(existsSync(configPath())).toBe(true)
  })

  it('whoami --json shows unauthenticated after logout', async () => {
    const { data, success, exitCode } = await runCliJson<WhoamiResult>(['whoami', '--json'], {
      cwd: tempHome,
      homeDir: tempHome,
    })

    expect(exitCode).toBe(0)
    expect(success).toBe(true)
    expect(data.authenticated).toBe(false)
    expect(data.user).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Login with writeMockCredentials (pre-seeded) then whoami
// ---------------------------------------------------------------------------

describe('E2E: auth via pre-seeded credentials', () => {
  let preSeededHome: string

  beforeAll(() => {
    preSeededHome = createTempDir()
    writeMockCredentials(preSeededHome, {
      platformUrl: server.url,
      token: 'pre-seeded-oauth-token',
    })
  })

  afterAll(() => {
    cleanupTempDir(preSeededHome)
  })

  it('whoami --json returns authenticated when credentials are pre-seeded with a token', async () => {
    const { data, success } = await runCliJson<WhoamiResult>(['whoami', '--json'], {
      cwd: preSeededHome,
      homeDir: preSeededHome,
    })

    expect(success).toBe(true)
    expect(data.authenticated).toBe(true)
    expect(data.platform).toBe(server.url)
    expect(data.user?.email).toBe('test@agentver.dev')
  })

  it('whoami --json returns authenticated when credentials are pre-seeded with an API key', async () => {
    const apiKeyHome = createTempDir()
    try {
      writeMockCredentials(apiKeyHome, {
        platformUrl: server.url,
        apiKey: 'sk-api-key-for-test',
      })

      const { data, success } = await runCliJson<WhoamiResult>(['whoami', '--json'], {
        cwd: apiKeyHome,
        homeDir: apiKeyHome,
      })

      expect(success).toBe(true)
      expect(data.authenticated).toBe(true)
      expect(data.user?.email).toBe('test@agentver.dev')
    } finally {
      cleanupTempDir(apiKeyHome)
    }
  })
})

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('E2E: auth error cases', () => {
  it('login with invalid token returns 401 from server', async () => {
    const errorHome = createTempDir()
    const errorServer = await createMockPlatformServer({
      routes: [
        {
          method: 'GET',
          path: '/api/v1/me',
          handler: (_req, res) => {
            res.json(401, { error: { code: 'UNAUTHORISED', message: 'Invalid token' } })
          },
        },
      ],
    })

    try {
      // Login itself succeeds (it just saves the token without verifying)
      const loginResult = await runCli(['login', errorServer.url, '--token', 'invalid-token'], {
        cwd: errorHome,
        homeDir: errorHome,
      })
      expect(loginResult.exitCode).toBe(0)

      // But whoami should report the auth failure
      const { success, exitCode, error } = await runCliJson<WhoamiResult>(['whoami', '--json'], {
        cwd: errorHome,
        homeDir: errorHome,
      })

      expect(exitCode).not.toBe(0)
      expect(success).toBe(false)
      expect(error?.code).toBe('UNAUTHORISED')
    } finally {
      await errorServer.close()
      cleanupTempDir(errorHome)
    }
  })

  it('whoami shows warning when platform is unreachable', async () => {
    const offlineHome = createTempDir()

    // Start a server, get its URL, then shut it down
    const deadServer = await createMockPlatformServer()
    const deadUrl = deadServer.url
    await deadServer.close()

    try {
      writeMockCredentials(offlineHome, {
        platformUrl: deadUrl,
        apiKey: 'sk-valid-but-server-dead',
      })

      const { data, success } = await runCliJson<WhoamiResult>(['whoami', '--json'], {
        cwd: offlineHome,
        homeDir: offlineHome,
      })

      // Should still report authenticated (credentials exist), but no user info
      expect(success).toBe(true)
      expect(data.authenticated).toBe(true)
      expect(data.user).toBeUndefined()
    } finally {
      cleanupTempDir(offlineHome)
    }
  })

  it('login --token rejects empty token value', async () => {
    const emptyTokenHome = createTempDir()
    try {
      const result = await runCli(['login', server.url, '--token', '   '], {
        cwd: emptyTokenHome,
        homeDir: emptyTokenHome,
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('Token must not be empty')

      // No credentials should be written
      expect(existsSync(join(emptyTokenHome, '.agentver', 'credentials.json'))).toBe(false)
    } finally {
      cleanupTempDir(emptyTokenHome)
    }
  })

  it('logout when not authenticated is a no-op', async () => {
    const unauthHome = createTempDir()
    try {
      const result = await runCli(['logout', '--yes'], { cwd: unauthHome, homeDir: unauthHome })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('not currently logged in')
    } finally {
      cleanupTempDir(unauthHome)
    }
  })
})

// ---------------------------------------------------------------------------
// Re-authentication flow
// ---------------------------------------------------------------------------

describe('E2E: re-authentication', () => {
  it('login with a new token overwrites existing credentials', async () => {
    const reauthHome = createTempDir()
    try {
      // First login
      await runCli(['login', server.url, '--token', 'first-token'], {
        cwd: reauthHome,
        homeDir: reauthHome,
      })

      const firstCreds = readJsonFile<{ apiKey?: string }>(
        join(reauthHome, '.agentver', 'credentials.json')
      )
      expect(firstCreds.apiKey).toBe('first-token')

      // Second login overwrites
      await runCli(['login', server.url, '--token', 'second-token'], {
        cwd: reauthHome,
        homeDir: reauthHome,
      })

      const secondCreds = readJsonFile<{ apiKey?: string }>(
        join(reauthHome, '.agentver', 'credentials.json')
      )
      expect(secondCreds.apiKey).toBe('second-token')
    } finally {
      cleanupTempDir(reauthHome)
    }
  })

  it('login with a different URL updates the platform URL in config', async () => {
    const urlChangeHome = createTempDir()
    const secondServer = await createMockPlatformServer()

    try {
      // Login to first server
      await runCli(['login', server.url, '--token', 'token-a'], {
        cwd: urlChangeHome,
        homeDir: urlChangeHome,
      })

      const firstConfig = readJsonFile<{ platformUrl?: string }>(
        join(urlChangeHome, '.agentver', 'config.json')
      )
      expect(firstConfig.platformUrl).toBe(server.url)

      // Login to second server
      await runCli(['login', secondServer.url, '--token', 'token-b'], {
        cwd: urlChangeHome,
        homeDir: urlChangeHome,
      })

      const secondConfig = readJsonFile<{ platformUrl?: string }>(
        join(urlChangeHome, '.agentver', 'config.json')
      )
      expect(secondConfig.platformUrl).toBe(secondServer.url)
    } finally {
      await secondServer.close()
      cleanupTempDir(urlChangeHome)
    }
  })
})

// ---------------------------------------------------------------------------
// JSON mode login output
// ---------------------------------------------------------------------------

describe('E2E: login JSON mode', () => {
  it('login --token --json outputs structured JSON', async () => {
    const jsonHome = createTempDir()
    try {
      const result = await runCli(['login', server.url, '--token', 'json-test-token', '--json'], {
        cwd: jsonHome,
        homeDir: jsonHome,
        env: { AGENTVER_JSON: '1' },
      })

      expect(result.exitCode).toBe(0)

      // Parse the JSON output
      const lines = result.stdout.trim().split('\n')
      const jsonLine = lines.find((l) => l.startsWith('{'))
      expect(jsonLine).toBeDefined()

      const parsed = JSON.parse(jsonLine!) as { success: boolean; data?: unknown }
      expect(parsed.success).toBe(true)
    } finally {
      cleanupTempDir(jsonHome)
    }
  })
})

// ---------------------------------------------------------------------------
// Request verification
// ---------------------------------------------------------------------------

describe('E2E: auth request verification', () => {
  it('whoami sends the correct X-API-Key header for API key credentials', async () => {
    const verifyHome = createTempDir()
    const verifyServer = await createMockPlatformServer()

    try {
      writeMockCredentials(verifyHome, {
        platformUrl: verifyServer.url,
        apiKey: 'sk-verify-header-test',
      })

      await runCliJson<WhoamiResult>(['whoami', '--json'], { cwd: verifyHome, homeDir: verifyHome })

      const meRequests = verifyServer.getRequestsFor('GET', '/api/v1/me')
      expect(meRequests.length).toBe(1)
      expect(meRequests[0]!.headers['x-api-key']).toBe('sk-verify-header-test')
    } finally {
      await verifyServer.close()
      cleanupTempDir(verifyHome)
    }
  })

  it('whoami sends Bearer token header for OAuth credentials', async () => {
    const verifyHome = createTempDir()
    const verifyServer = await createMockPlatformServer()

    try {
      writeMockCredentials(verifyHome, {
        platformUrl: verifyServer.url,
        token: 'oauth-verify-token',
      })

      await runCliJson<WhoamiResult>(['whoami', '--json'], { cwd: verifyHome, homeDir: verifyHome })

      const meRequests = verifyServer.getRequestsFor('GET', '/api/v1/me')
      expect(meRequests.length).toBe(1)
      expect(meRequests[0]!.headers.authorization).toBe('Bearer oauth-verify-token')
    } finally {
      await verifyServer.close()
      cleanupTempDir(verifyHome)
    }
  })
})
