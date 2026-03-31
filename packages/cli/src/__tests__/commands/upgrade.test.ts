import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformMockHandle } from '../helpers/mock-platform'
import { mockFetchResponse, setupPlatformMock } from '../helpers/mock-platform'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// vi.hoisted ensures the variable is available when vi.mock factories run
const { execFileAsyncMock } = vi.hoisted(() => ({
  execFileAsyncMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('node:util', () => ({
  promisify: vi.fn().mockReturnValue(execFileAsyncMock),
}))

vi.mock('node:module', () => ({
  createRequire: vi.fn().mockReturnValue(vi.fn().mockReturnValue({ version: '1.0.0' })),
}))

vi.mock('node:url', () => ({
  fileURLToPath: vi.fn().mockReturnValue('/mock/cli/src/commands/upgrade.ts'),
}))

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path')
  return {
    ...actual,
    dirname: vi.fn().mockReturnValue('/mock/cli/src/commands'),
    join: actual.join,
  }
})

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
import { registerUpgradeCommand } from '../../commands/upgrade'
import * as outputModule from '../../output.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerUpgradeCommand(program)
  return program
}

async function runUpgrade(args: string[]): Promise<void> {
  const program = createProgram()
  try {
    await program.parseAsync(['node', 'agentver', ...args])
  } catch {
    // Catch CommanderError or process.exit errors
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commands/upgrade', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  let platformMock: PlatformMockHandle

  beforeEach(() => {
    vi.clearAllMocks()
    execFileAsyncMock.mockReset()
    process.argv = ['node', 'agentver', 'upgrade']
    process.exit = vi.fn() as never

    vi.mocked(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

    platformMock = setupPlatformMock()
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------------------------
  // 1. Bun detected
  // -------------------------------------------------------------------------

  describe('bun detected', () => {
    it('runs bun install -g when bun is available', async () => {
      platformMock.addRoute({
        method: 'GET',
        path: /registry\.npmjs\.org/,
        handler: () => mockFetchResponse(200, { version: '2.0.0' }),
      })

      // bun --version succeeds, bun pm ls -g returns agentver
      execFileAsyncMock
        .mockResolvedValueOnce({ stdout: '1.0.0' }) // bun --version
        .mockResolvedValueOnce({ stdout: 'agentver' }) // bun pm ls -g
        .mockResolvedValueOnce({ stdout: '' }) // bun install -g
        .mockResolvedValueOnce({ stdout: '@agentver/cli@2.0.0' }) // verification

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'upgrade', '--json']

      await runUpgrade(['upgrade'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.packageManager).toBe('bun')
      expect(typed.previous).toBe('1.0.0')
      expect(typed.latest).toBe('2.0.0')
    })
  })

  // -------------------------------------------------------------------------
  // 2. npm fallback
  // -------------------------------------------------------------------------

  describe('npm fallback', () => {
    it('falls back to npm when bun is not available', async () => {
      platformMock.addRoute({
        method: 'GET',
        path: /registry\.npmjs\.org/,
        handler: () => mockFetchResponse(200, { version: '2.0.0' }),
      })

      execFileAsyncMock
        .mockRejectedValueOnce(new Error('not found')) // bun --version
        .mockRejectedValueOnce(new Error('not found')) // pnpm --version
        .mockRejectedValueOnce(new Error('not found')) // yarn --version
        .mockResolvedValueOnce({ stdout: '10.0.0' }) // npm --version
        .mockResolvedValueOnce({ stdout: 'agentver' }) // npm list -g
        .mockResolvedValueOnce({ stdout: '' }) // npm install -g
        .mockResolvedValueOnce({ stdout: '@agentver/cli@2.0.0' }) // verification

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'upgrade', '--json']

      await runUpgrade(['upgrade'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.packageManager).toBe('npm')
    })
  })

  // -------------------------------------------------------------------------
  // 3. Already latest
  // -------------------------------------------------------------------------

  describe('already latest version', () => {
    it('shows up-to-date message when current matches latest', async () => {
      platformMock.addRoute({
        method: 'GET',
        path: /registry\.npmjs\.org/,
        handler: () => mockFetchResponse(200, { version: '1.0.0' }),
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'upgrade', '--json']

      await runUpgrade(['upgrade'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.upToDate).toBe(true)
      expect(typed.current).toBe('1.0.0')
      expect(typed.latest).toBe('1.0.0')
    })
  })

  // -------------------------------------------------------------------------
  // 4. New version available
  // -------------------------------------------------------------------------

  describe('new version available', () => {
    it('shows version being upgraded to in JSON output', async () => {
      platformMock.addRoute({
        method: 'GET',
        path: /registry\.npmjs\.org/,
        handler: () => mockFetchResponse(200, { version: '3.0.0' }),
      })

      // Fall back to npm default (all managers fail)
      execFileAsyncMock
        .mockRejectedValueOnce(new Error('not found')) // bun
        .mockRejectedValueOnce(new Error('not found')) // pnpm
        .mockRejectedValueOnce(new Error('not found')) // yarn
        .mockRejectedValueOnce(new Error('not found')) // npm --version fails
        .mockResolvedValueOnce({ stdout: '' }) // npm install -g (default)
        .mockResolvedValueOnce({ stdout: '@agentver/cli@3.0.0' }) // verification

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'upgrade', '--json']

      await runUpgrade(['upgrade'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.previous).toBe('1.0.0')
      expect(typed.latest).toBe('3.0.0')
    })
  })

  // -------------------------------------------------------------------------
  // 5. Registry check fails
  // -------------------------------------------------------------------------

  describe('registry check failure', () => {
    it('outputs UPGRADE_FAILED error when npm registry is unreachable', async () => {
      platformMock.addRoute({
        method: 'GET',
        path: /registry\.npmjs\.org/,
        handler: () => mockFetchResponse(500, 'Server error'),
      })

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'upgrade', '--json']

      await runUpgrade(['upgrade'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'UPGRADE_FAILED',
        expect.stringContaining('Failed to check')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('rejects invalid semver passed via --version before hitting the registry', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'upgrade', '--json']

      await runUpgrade(['upgrade', '--version', '../some-other-package'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'UPGRADE_FAILED',
        'Invalid version "../some-other-package". Expected a valid semver version.'
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 6. --json output
  // -------------------------------------------------------------------------

  describe('--json output', () => {
    it('includes previous, latest, and packageManager fields', async () => {
      platformMock.addRoute({
        method: 'GET',
        path: /registry\.npmjs\.org/,
        handler: () => mockFetchResponse(200, { version: '2.5.0' }),
      })

      execFileAsyncMock
        .mockRejectedValueOnce(new Error('not found')) // bun
        .mockRejectedValueOnce(new Error('not found')) // pnpm
        .mockRejectedValueOnce(new Error('not found')) // yarn
        .mockResolvedValueOnce({ stdout: '10.0.0' }) // npm --version
        .mockResolvedValueOnce({ stdout: 'agentver' }) // npm list -g
        .mockResolvedValueOnce({ stdout: '' }) // npm install -g
        .mockResolvedValueOnce({ stdout: '@agentver/cli@2.5.0' }) // verification

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'upgrade', '--json']

      await runUpgrade(['upgrade'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed).toHaveProperty('previous')
      expect(typed).toHaveProperty('latest')
      expect(typed).toHaveProperty('packageManager')
    })
  })

  // -------------------------------------------------------------------------
  // 7. Version verification failure
  // -------------------------------------------------------------------------

  describe('version verification failure', () => {
    it('reports UPGRADE_FAILED when installed version does not match expected', async () => {
      platformMock.addRoute({
        method: 'GET',
        path: /registry\.npmjs\.org/,
        handler: () => mockFetchResponse(200, { version: '2.0.0' }),
      })

      execFileAsyncMock
        .mockRejectedValueOnce(new Error('not found')) // bun
        .mockRejectedValueOnce(new Error('not found')) // pnpm
        .mockRejectedValueOnce(new Error('not found')) // yarn
        .mockResolvedValueOnce({ stdout: '10.0.0' }) // npm --version
        .mockResolvedValueOnce({ stdout: 'agentver' }) // npm list -g
        .mockResolvedValueOnce({ stdout: '' }) // npm install -g
        .mockResolvedValueOnce({ stdout: '@agentver/cli@1.0.0' }) // verification — still old version

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'upgrade', '--json']

      await runUpgrade(['upgrade'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'UPGRADE_FAILED',
        expect.stringContaining('does not match v2.0.0')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('includes manual install hint in the error message', async () => {
      platformMock.addRoute({
        method: 'GET',
        path: /registry\.npmjs\.org/,
        handler: () => mockFetchResponse(200, { version: '2.0.0' }),
      })

      execFileAsyncMock
        .mockResolvedValueOnce({ stdout: '1.0.0' }) // bun --version
        .mockResolvedValueOnce({ stdout: 'agentver' }) // bun pm ls -g
        .mockResolvedValueOnce({ stdout: '' }) // bun install -g
        .mockResolvedValueOnce({ stdout: '@agentver/cli@1.0.0' }) // verification — still old version

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'upgrade', '--json']

      await runUpgrade(['upgrade'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'UPGRADE_FAILED',
        expect.stringContaining('bun install -g @agentver/cli@latest')
      )
    })

    it('handles verification command failure gracefully', async () => {
      platformMock.addRoute({
        method: 'GET',
        path: /registry\.npmjs\.org/,
        handler: () => mockFetchResponse(200, { version: '2.0.0' }),
      })

      execFileAsyncMock
        .mockRejectedValueOnce(new Error('not found')) // bun
        .mockRejectedValueOnce(new Error('not found')) // pnpm
        .mockRejectedValueOnce(new Error('not found')) // yarn
        .mockResolvedValueOnce({ stdout: '10.0.0' }) // npm --version
        .mockResolvedValueOnce({ stdout: 'agentver' }) // npm list -g
        .mockResolvedValueOnce({ stdout: '' }) // npm install -g
        .mockRejectedValueOnce(new Error('command timed out')) // verification fails

      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'upgrade', '--json']

      await runUpgrade(['upgrade'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'UPGRADE_FAILED',
        expect.stringContaining('command timed out')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })
})
