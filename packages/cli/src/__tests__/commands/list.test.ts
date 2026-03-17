import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createManifest,
  createManifestPackage,
  createSharedGitSource,
  createWellKnownSource,
} from '../helpers/fixtures'

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any import of the SUT
// ---------------------------------------------------------------------------

vi.mock('../../storage/manifest', () => ({
  readManifest: vi.fn(),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn(),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  })),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { registerListCommand } from '../../commands/list'

// ---------------------------------------------------------------------------
// Mock module imports (typed references)
// ---------------------------------------------------------------------------

import { Command } from 'commander'
import * as outputModule from '../../output.js'
import * as manifestModule from '../../storage/manifest'

describe('list command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createProgram(): InstanceType<typeof Command> {
    const program = new Command()
    program.exitOverride()
    registerListCommand(program)
    return program
  }

  async function runList(...args: string[]): Promise<void> {
    const program = createProgram()
    await program.parseAsync(['node', 'agentver', 'list', ...args])
  }

  // ---------------------------------------------------------------------------
  // Happy path: multiple packages listed
  // ---------------------------------------------------------------------------

  describe('happy path', () => {
    it('lists multiple packages with name, ref, commit, and agents', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'main',
                commit: 'abc1234567890',
              }),
              agents: ['claude-code'],
            }),
            'another-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo2',
                ref: 'v2.0.0',
                commit: 'def4567890abc',
              }),
              agents: ['cursor', 'windsurf'],
            }),
          },
        })
      )

      await runList()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('test-skill')
      expect(output).toContain('another-skill')
      expect(output).toContain('Installed packages (2)')
    })
  })

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  describe('empty state', () => {
    it('shows a clean empty state message when no packages are installed', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await runList()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('No packages installed')
    })
  })

  // ---------------------------------------------------------------------------
  // Pinned package
  // ---------------------------------------------------------------------------

  describe('pinned package', () => {
    it('shows a pinned indicator for pinned packages', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'pinned-skill': createManifestPackage({
              pinned: true,
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'v1.0.0',
                commit: 'abc1234567890',
              }),
            }),
          },
        })
      )

      await runList()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('pinned')
    })
  })

  // ---------------------------------------------------------------------------
  // Multiple agents per package
  // ---------------------------------------------------------------------------

  describe('multiple agents per package', () => {
    it('shows all agent assignments correctly', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'multi-agent-skill': createManifestPackage({
              agents: ['claude-code', 'cursor', 'windsurf'],
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'main',
                commit: 'abc1234567890',
              }),
            }),
          },
        })
      )

      await runList()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('claude-code')
      expect(output).toContain('cursor')
      expect(output).toContain('windsurf')
    })
  })

  // ---------------------------------------------------------------------------
  // --json output
  // ---------------------------------------------------------------------------

  describe('--json output', () => {
    it('outputs JSON matching the ListResult schema', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const packages = {
        'test-skill': createManifestPackage(),
      }

      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest({ packages }))

      await runList()

      expect(vi.mocked(outputModule.outputSuccess)).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: Record<string, unknown>
      }
      expect(data).toHaveProperty('packages')
      expect(data.packages).toHaveProperty('test-skill')
    })

    it('outputs empty packages object when nothing is installed', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await runList()

      expect(vi.mocked(outputModule.outputSuccess)).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: Record<string, unknown>
      }
      expect(data.packages).toEqual({})
    })
  })

  // ---------------------------------------------------------------------------
  // Well-known source package
  // ---------------------------------------------------------------------------

  describe('well-known source package', () => {
    it('renders well-known source packages with hostname', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'wk-skill': createManifestPackage({
              source: createWellKnownSource({
                hostname: 'skills.example.com',
              }),
            }),
          },
        })
      )

      await runList()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('wk-skill')
      expect(output).toContain('skills.example.com')
      expect(output).toContain('well-known')
    })
  })
})
