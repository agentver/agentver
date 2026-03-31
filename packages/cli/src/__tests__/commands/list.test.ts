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
        packages: Array<{ name: string; scope: string; package: unknown }>
      }
      expect(data).toHaveProperty('packages')
      expect(data.packages).toContainEqual(
        expect.objectContaining({
          name: 'test-skill',
          scope: 'project',
        })
      )
    })

    it('outputs an empty packages array when nothing is installed', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await runList()

      expect(vi.mocked(outputModule.outputSuccess)).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: unknown[]
      }
      expect(data.packages).toEqual([])
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

  // ---------------------------------------------------------------------------
  // --global flag
  // ---------------------------------------------------------------------------

  describe('--global flag', () => {
    it('reads manifest with global scope', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'global-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/global-repo',
                ref: 'main',
                commit: 'aaa1234567890',
              }),
              agents: ['claude-code'],
            }),
          },
        })
      )

      await runList('--global')

      expect(manifestModule.readManifest).toHaveBeenCalledWith(expect.any(String), 'global')
      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('global-skill')
    })
  })

  // ---------------------------------------------------------------------------
  // --all flag
  // ---------------------------------------------------------------------------

  describe('--all flag', () => {
    it('shows both project and global packages with section headers', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      const projectManifest = createManifest({
        packages: {
          'project-skill': createManifestPackage({
            source: createSharedGitSource({
              uri: 'github.com/org/project-repo',
              ref: 'main',
              commit: 'aaa1234567890',
            }),
          }),
        },
      })

      const globalManifest = createManifest({
        packages: {
          'shared-skill': createManifestPackage({
            source: createSharedGitSource({
              uri: 'github.com/org/shared-repo',
              ref: 'main',
              commit: 'bbb1234567890',
            }),
          }),
        },
      })

      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(projectManifest)
        .mockReturnValueOnce(globalManifest)

      await runList('--all')

      expect(manifestModule.readManifest).toHaveBeenCalledWith(expect.any(String), 'project')
      expect(manifestModule.readManifest).toHaveBeenCalledWith(expect.any(String), 'global')

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('Project packages')
      expect(output).toContain('User packages')
      expect(output).toContain('project-skill')
      expect(output).toContain('shared-skill')
    })

    it('shows section headers even when one scope is empty', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(createManifest())
        .mockReturnValueOnce(
          createManifest({
            packages: {
              'global-skill': createManifestPackage({
                source: createSharedGitSource({
                  uri: 'github.com/org/repo',
                  ref: 'main',
                  commit: 'ccc1234567890',
                }),
              }),
            },
          })
        )

      await runList('--all')

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('Project packages (0)')
      expect(output).toContain('User packages (1)')
      expect(output).toContain('global-skill')
    })
  })

  // ---------------------------------------------------------------------------
  // Bundle-aware grouping
  // ---------------------------------------------------------------------------

  describe('bundle grouping', () => {
    it('groups constituents under their parent bundle', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'my-bundle': createManifestPackage({
              source: createSharedGitSource({ ref: 'main', commit: 'abc1234567' }),
              packageType: 'BUNDLE',
            }),
            'skill-a': createManifestPackage({
              source: createSharedGitSource({ ref: 'main', commit: 'def5678901' }),
              bundle: 'my-bundle',
            }),
            'skill-b': createManifestPackage({
              source: createSharedGitSource({ ref: 'main', commit: 'ghi2345678' }),
              bundle: 'my-bundle',
            }),
            'standalone-skill': createManifestPackage({
              source: createSharedGitSource({ ref: 'main', commit: 'jkl3456789' }),
            }),
          },
        })
      )

      await runList()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('my-bundle')
      expect(output).toContain('bundle')
      expect(output).toContain('skill-a')
      expect(output).toContain('skill-b')
      expect(output).toContain('standalone-skill')
    })

    it('renders orphaned constituent when bundle entry is absent', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'orphan-skill': createManifestPackage({
              source: createSharedGitSource({ ref: 'main', commit: 'abc1234567' }),
              bundle: 'removed-bundle',
            }),
          },
        })
      )

      await runList()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('removed-bundle')
      expect(output).toContain('orphan-skill')
    })

    it('includes bundle field in JSON output', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'my-bundle': createManifestPackage({
              packageType: 'BUNDLE',
            }),
            'skill-a': createManifestPackage({
              bundle: 'my-bundle',
            }),
          },
        })
      )

      await runList()

      expect(vi.mocked(outputModule.outputSuccess)).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: Array<{
          name: string
          package: { bundle?: string; packageType?: string }
        }>
      }
      expect(data.packages).toContainEqual(
        expect.objectContaining({
          name: 'my-bundle',
          package: expect.objectContaining({ packageType: 'BUNDLE' }),
        })
      )
      expect(data.packages).toContainEqual(
        expect.objectContaining({
          name: 'skill-a',
          package: expect.objectContaining({ bundle: 'my-bundle' }),
        })
      )
    })

    it('keeps distinct bundles separate when they share a display name', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            bundleA: createManifestPackage({
              name: 'shared-bundle',
              source: createSharedGitSource({
                uri: 'https://github.com/org/repo-a',
                path: 'skills/shared-bundle',
                ref: 'main',
                commit: 'abc1234567',
              }),
              packageType: 'BUNDLE',
            }),
            bundleB: createManifestPackage({
              name: 'shared-bundle',
              source: createSharedGitSource({
                uri: 'https://github.com/org/repo-b',
                path: 'skills/shared-bundle',
                ref: 'main',
                commit: 'def1234567',
              }),
              packageType: 'BUNDLE',
            }),
            skillA: createManifestPackage({
              name: 'skill-a',
              source: createSharedGitSource({ ref: 'main', commit: '1111111111' }),
              bundle: 'bundleA',
            }),
            skillB: createManifestPackage({
              name: 'skill-b',
              source: createSharedGitSource({ ref: 'main', commit: '2222222222' }),
              bundle: 'bundleB',
            }),
          },
        })
      )

      await runList()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      const bundleHeaderCount = (output.match(/shared-bundle/g) ?? []).length
      expect(bundleHeaderCount).toBeGreaterThanOrEqual(2)
      expect(output).toContain('skill-a')
      expect(output).toContain('skill-b')
    })
  })
})
