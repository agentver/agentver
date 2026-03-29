import { createCLIOutputSchema, syncResultSchema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCredentials, createManifest, createManifestPackage } from '../helpers/fixtures'
import type { PlatformMockHandle } from '../helpers/mock-platform'
import { mockFetchResponse, setupPlatformMock } from '../helpers/mock-platform'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn(),
}))

vi.mock('../../registry/auth.js', () => ({
  getCredentials: vi.fn(),
  isAuthenticated: vi.fn(),
}))

vi.mock('../../registry/config.js', () => ({
  getPlatformUrl: vi.fn(),
  readConfig: vi.fn(),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { Command } from 'commander'
import { registerSyncCommand } from '../../commands/sync'
import * as outputModule from '../../output.js'
import * as authModule from '../../registry/auth.js'
import * as configModule from '../../registry/config.js'
import * as manifestModule from '../../storage/manifest.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerSyncCommand(program)
  return program
}

async function runSync(args: string[]): Promise<void> {
  const program = createProgram()
  await program.parseAsync(['node', 'agentver', ...args])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commands/sync', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit
  let platformMock: PlatformMockHandle

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn().mockReturnValue('/project')
    process.argv = ['node', 'agentver', 'sync']
    process.exit = vi.fn() as never

    vi.mocked(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

    platformMock = setupPlatformMock()
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------------------------
  // 1. Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('reads manifest and POSTs packages to platform', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'skill-a': createManifestPackage(),
          },
        })
      )

      platformMock.addRoute({
        method: 'POST',
        path: /\/installations\/sync$/,
        handler: () => mockFetchResponse(200, { synced: 1, removed: 0 }),
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'sync', '--json']

      await runSync(['sync'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.synced).toBe(1)
      expect(typed.packages).toEqual(['skill-a'])
    })
  })

  // -------------------------------------------------------------------------
  // 2. Empty manifest
  // -------------------------------------------------------------------------

  describe('empty manifest', () => {
    it('sends empty packages list to platform', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      platformMock.addRoute({
        method: 'POST',
        path: /\/installations\/sync$/,
        handler: (_url, init) => {
          const body = JSON.parse(init?.body as string) as Record<string, unknown>
          expect(body.packages).toEqual({})
          return mockFetchResponse(200, { synced: 0, removed: 0 })
        },
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'sync', '--json']

      await runSync(['sync'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.synced).toBe(0)
      expect(typed.packages).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // 3. Not authenticated
  // -------------------------------------------------------------------------

  describe('not authenticated', () => {
    it('outputs AUTH_REQUIRED error when no credentials exist', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(null)
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'sync', '--json']

      // process.exit doesn't halt; code continues and accesses creds.token
      try {
        await runSync(['sync'])
      } catch {
        // Expected — code continues past mocked process.exit
      }

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'AUTH_REQUIRED',
        expect.stringContaining('Not connected')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 4. No platform URL
  // -------------------------------------------------------------------------

  describe('no platform connection', () => {
    it('outputs AUTH_REQUIRED error when no platform URL configured', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)
      vi.mocked(authModule.getCredentials).mockResolvedValue(null)
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'sync', '--json']

      // process.exit doesn't halt; code continues and accesses creds.token
      try {
        await runSync(['sync'])
      } catch {
        // Expected — code continues past mocked process.exit
      }

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'AUTH_REQUIRED',
        expect.stringContaining('Not connected')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 5. API error
  // -------------------------------------------------------------------------

  describe('API error', () => {
    it('surfaces platform error to user', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      platformMock.addRoute({
        method: 'POST',
        path: /\/installations\/sync$/,
        handler: () => mockFetchResponse(500, 'Internal server error'),
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'sync', '--json']

      await runSync(['sync'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'SYNC_FAILED',
        expect.stringContaining('500')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 6. --json output validates against syncResultSchema
  // -------------------------------------------------------------------------

  describe('--json output', () => {
    it('validates against syncResultSchema', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'skill-a': createManifestPackage(),
          },
        })
      )

      platformMock.addRoute({
        method: 'POST',
        path: /\/installations\/sync$/,
        handler: () => mockFetchResponse(200, { synced: 1, removed: 0 }),
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'sync', '--json']

      await runSync(['sync'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const envelope = { success: true, data }
      const outputSchema = createCLIOutputSchema(syncResultSchema)
      const result = outputSchema.safeParse(envelope)
      expect(result.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // 7. Machine ID included in request
  // -------------------------------------------------------------------------

  describe('machine ID', () => {
    it('includes machineId in the sync request body', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      let capturedBody: Record<string, unknown> | undefined

      platformMock.addRoute({
        method: 'POST',
        path: /\/installations\/sync$/,
        handler: (_url, init) => {
          capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>
          return mockFetchResponse(200, { synced: 0, removed: 0 })
        },
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'sync', '--json']

      await runSync(['sync'])

      expect(capturedBody).toBeDefined()
      expect(typeof capturedBody!.machineId).toBe('string')
      expect((capturedBody!.machineId as string).length).toBeGreaterThan(0)
    })

    it('includes machineId in the JSON output', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://app.agentver.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(createCredentials())
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      platformMock.addRoute({
        method: 'POST',
        path: /\/installations\/sync$/,
        handler: () => mockFetchResponse(200, { synced: 0, removed: 0 }),
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'sync', '--json']

      await runSync(['sync'])

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typeof typed.machineId).toBe('string')
      expect((typed.machineId as string).length).toBe(64) // SHA256 hex = 64 chars
    })
  })
})
