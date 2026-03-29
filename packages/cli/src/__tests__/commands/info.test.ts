import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createSharedGitSource,
  createSkillMd,
} from '../helpers/fixtures'

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile.js', () => ({
  readLockfile: vi.fn(),
}))

vi.mock('../../storage/canonical.js', () => ({
  resolveReadPath: vi.fn(),
}))

vi.mock('../../storage/integrity.js', () => ({
  computeSha256FromFiles: vi.fn(),
}))

vi.mock('../../git/fetcher.js', () => ({
  readFilesFromDirectory: vi.fn(),
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

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(),
  }
})

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { registerInfoCommand } from '../../commands/info'

// ---------------------------------------------------------------------------
// Mock module imports (typed references)
// ---------------------------------------------------------------------------

import * as nodeFs from 'node:fs'
import { Command } from 'commander'
import * as fetcherModule from '../../git/fetcher.js'
import * as outputModule from '../../output.js'
import * as canonicalModule from '../../storage/canonical.js'
import * as integrityModule from '../../storage/integrity.js'
import * as lockfileModule from '../../storage/lockfile.js'
import * as manifestModule from '../../storage/manifest.js'

describe('info command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createProgram(): InstanceType<typeof Command> {
    const program = new Command()
    program.exitOverride()
    registerInfoCommand(program)
    return program
  }

  async function runInfo(...args: string[]): Promise<void> {
    const program = createProgram()
    await program.parseAsync(['node', 'agentver', 'info', ...args])
  }

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  describe('happy path', () => {
    it('shows all metadata for an installed package', async () => {
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
              installedAt: '2025-01-15T10:30:00.000Z',
            }),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-abc123def456',
            }),
          },
        })
      )

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/tmp/project/.agents/skills/test-skill'
      )

      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: '# Test', size: 100 },
        { path: 'ref.md', content: '# Ref', size: 50 },
      ])

      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-abc123def456')

      vi.mocked(nodeFs.readFileSync).mockImplementation(() => {
        throw new Error('File not found')
      })

      await runInfo('test-skill')

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('test-skill')
      expect(output).toContain('github.com/org/repo')
      expect(output).toContain('main')
      expect(output).toContain('claude-code')
      expect(output).toContain('2 files')
      expect(output).toContain('sha256-abc123def456')
    })
  })

  // ---------------------------------------------------------------------------
  // SKILL.md parsing
  // ---------------------------------------------------------------------------

  describe('SKILL.md parsing', () => {
    it('extracts title and description from SKILL.md frontmatter', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage(),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/tmp/project/.agents/skills/test-skill'
      )

      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: createSkillMd(), size: 200 },
      ])

      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-xyz')

      const skillContent = createSkillMd({
        name: 'my-test-skill',
        description: 'A great skill for testing',
      })
      vi.mocked(nodeFs.readFileSync).mockReturnValue(skillContent)

      await runInfo('test-skill')

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('my-test-skill')
      expect(output).toContain('A great skill for testing')
    })
  })

  // ---------------------------------------------------------------------------
  // Not installed
  // ---------------------------------------------------------------------------

  describe('not installed', () => {
    it('gives an error with the package name when not installed', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await expect(runInfo('nonexistent')).rejects.toThrow()

      expect(exitSpy).toHaveBeenCalledWith(1)
      const output = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('nonexistent')
      expect(output).toContain('not installed')
    })

    it('outputs JSON error when not installed in JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await expect(runInfo('nonexistent')).rejects.toThrow()

      expect(vi.mocked(outputModule.outputError)).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('nonexistent')
      )
    })
  })

  // ---------------------------------------------------------------------------
  // --global flag
  // ---------------------------------------------------------------------------

  describe('--global flag', () => {
    it('passes global scope to readManifest, readLockfile, and resolveReadPath', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              agents: ['claude-code'],
            }),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())
      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(null)
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([])

      await runInfo('test-skill', '--global')

      expect(manifestModule.readManifest).toHaveBeenCalledWith(expect.any(String), 'global')
      expect(lockfileModule.readLockfile).toHaveBeenCalledWith(expect.any(String), 'global')
      expect(canonicalModule.resolveReadPath).toHaveBeenCalledWith(
        expect.any(String),
        'test-skill',
        ['claude-code'],
        'global'
      )
    })

    it('defaults to project scope without --global', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              agents: ['claude-code'],
            }),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())
      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(null)
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([])

      await runInfo('test-skill')

      expect(manifestModule.readManifest).toHaveBeenCalledWith(expect.any(String), 'project')
      expect(lockfileModule.readLockfile).toHaveBeenCalledWith(expect.any(String), 'project')
    })
  })

  // ---------------------------------------------------------------------------
  // Cross-scope hint
  // ---------------------------------------------------------------------------

  describe('cross-scope hint', () => {
    it('hints about global scope when package exists globally but not in project', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(createManifest())
        .mockReturnValueOnce(
          createManifest({
            packages: {
              'global-skill': createManifestPackage(),
            },
          })
        )

      await expect(runInfo('global-skill')).rejects.toThrow()

      const output = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('--global')
    })

    it('hints about project scope when using --global and package exists in project', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(createManifest())
        .mockReturnValueOnce(
          createManifest({
            packages: {
              'project-skill': createManifestPackage(),
            },
          })
        )

      await expect(runInfo('project-skill', '--global')).rejects.toThrow()

      const output = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('without --global')
    })

    it('includes hint in JSON error when package exists in other scope', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(createManifest())
        .mockReturnValueOnce(
          createManifest({
            packages: {
              'global-skill': createManifestPackage(),
            },
          })
        )

      await expect(runInfo('global-skill')).rejects.toThrow()

      expect(vi.mocked(outputModule.outputError)).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('--global')
      )
    })

    it('does not hint when package is not in either scope', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await expect(runInfo('nonexistent')).rejects.toThrow()

      const output = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).not.toContain('--global')
      expect(output).not.toContain('Found in')
    })
  })

  // ---------------------------------------------------------------------------
  // --json output
  // ---------------------------------------------------------------------------

  describe('--json output', () => {
    it('outputs JSON matching the InfoResult schema', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

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
              installedAt: '2025-01-15T10:30:00.000Z',
            }),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-abc123def456',
            }),
          },
        })
      )

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/tmp/project/.agents/skills/test-skill'
      )

      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: '# Test', size: 100 },
      ])

      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-abc123def456')
      vi.mocked(nodeFs.readFileSync).mockImplementation(() => {
        throw new Error('File not found')
      })

      await runInfo('test-skill')

      const mockedOutputSuccess = vi.mocked(outputModule.outputSuccess)
      expect(mockedOutputSuccess).toHaveBeenCalledOnce()
      const data = mockedOutputSuccess.mock.calls[0]![0] as Record<string, unknown>
      expect(data.name).toBe('test-skill')
      expect(data.source).toEqual({
        type: 'git',
        uri: 'github.com/org/repo',
        ref: 'main',
        commit: 'abc1234567890',
      })
      expect(data.agents).toEqual(['claude-code'])
      expect(data.modified).toBe(false)
      expect(data.integrity).toBe('sha256-abc123def456')
      expect(data.files).toEqual({ count: 1, totalSize: 100 })
    })
  })

  // ---------------------------------------------------------------------------
  // Modified flag
  // ---------------------------------------------------------------------------

  describe('modified flag', () => {
    it('shows locally modified warning when integrity differs', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage(),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-original-hash',
            }),
          },
        })
      )

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/tmp/project/.agents/skills/test-skill'
      )

      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: '# Modified content', size: 120 },
      ])

      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-different-hash')
      vi.mocked(nodeFs.readFileSync).mockImplementation(() => {
        throw new Error('File not found')
      })

      await runInfo('test-skill')

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('yes')
    })
  })

  // ---------------------------------------------------------------------------
  // Integrity hash from lockfile
  // ---------------------------------------------------------------------------

  describe('integrity check', () => {
    it('shows the integrity hash from the lockfile', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage(),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-specificHashValue',
            }),
          },
        })
      )

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/tmp/project/.agents/skills/test-skill'
      )
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([])
      vi.mocked(nodeFs.readFileSync).mockImplementation(() => {
        throw new Error('File not found')
      })

      await runInfo('test-skill')

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('sha256-specificHashValue')
    })
  })
})
