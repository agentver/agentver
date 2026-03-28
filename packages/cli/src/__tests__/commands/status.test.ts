import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGitSource,
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createSharedGitSource,
} from '../helpers/fixtures'

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any import of the SUT
// ---------------------------------------------------------------------------

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

vi.mock('../../git/index.js', () => ({
  resolveRef: vi.fn(),
}))

vi.mock('@agentver/agent-definitions', () => ({
  getAgentPlacementPath: vi.fn(),
  getCommandPlacementPath: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}))

vi.mock('../../utils/paths', () => ({
  resolvePlacementPath: vi.fn(),
}))

vi.mock('../../output', () => ({
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

import { registerStatusCommand } from '../../commands/status'

// ---------------------------------------------------------------------------
// Mock module imports (typed references)
// ---------------------------------------------------------------------------

import * as nodeFs from 'node:fs'
import * as agentDefs from '@agentver/agent-definitions'
import * as pathsModule from '../../utils/paths'
import * as fetcherModule from '../../git/fetcher.js'
import * as gitModule from '../../git/index.js'
import * as outputModule from '../../output'
import * as canonicalModule from '../../storage/canonical.js'
import * as integrityModule from '../../storage/integrity.js'
import * as lockfileModule from '../../storage/lockfile.js'
import * as manifestModule from '../../storage/manifest.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('status command', () => {
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
    registerStatusCommand(program)
    return program
  }

  async function runStatus(...args: string[]): Promise<void> {
    const program = createProgram()
    await program.parseAsync(['node', 'agentver', 'status', ...args])
  }

  // ---------------------------------------------------------------------------
  // All up-to-date
  // ---------------------------------------------------------------------------

  describe('all up-to-date', () => {
    it('shows clean output when all packages match lockfile SHAs', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'main',
                commit: commitSha,
              }),
            }),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-matching-hash',
            }),
          },
        })
      )

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/tmp/project/.agents/skills/test-skill'
      )
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: '# Test', size: 50 },
      ])
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-matching-hash')
      vi.mocked(gitModule.resolveRef).mockResolvedValue({ source: createGitSource(), commitSha })

      await runStatus()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('test-skill')
    })
  })

  // ---------------------------------------------------------------------------
  // Locally modified
  // ---------------------------------------------------------------------------

  describe('locally modified', () => {
    it('shows MODIFIED status when local files differ from lockfile hash', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'main',
                commit: commitSha,
              }),
            }),
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
        { path: 'SKILL.md', content: '# Modified', size: 60 },
      ])
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-different-hash')
      vi.mocked(gitModule.resolveRef).mockResolvedValue({ source: createGitSource(), commitSha })

      await runStatus('--offline')

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: Array<{ name: string; status: string; modified: boolean }>
      }

      expect(data.packages[0]!.status).toBe('modified')
      expect(data.packages[0]!.modified).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Upstream available
  // ---------------------------------------------------------------------------

  describe('upstream available', () => {
    it('shows UPDATE AVAILABLE when resolveRef returns a different SHA', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const oldCommit = 'abc1234567890abcdef1234567890abcdef1234567'
      const newCommit = 'def7890123456789abcdef1234567890abcdef12345'

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'main',
                commit: oldCommit,
              }),
            }),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-matching-hash',
            }),
          },
        })
      )

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/tmp/project/.agents/skills/test-skill'
      )
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: '# Test', size: 50 },
      ])
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-matching-hash')
      vi.mocked(gitModule.resolveRef).mockResolvedValue({
        source: createGitSource(),
        commitSha: newCommit,
      })

      await runStatus()

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: Array<{ name: string; status: string; upstream: boolean }>
      }

      expect(data.packages[0]!.status).toBe('upstream')
      expect(data.packages[0]!.upstream).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Both modified and upstream
  // ---------------------------------------------------------------------------

  describe('both modified and upstream', () => {
    it('shows both indicators when local is modified and upstream has changed', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const oldCommit = 'abc1234567890abcdef1234567890abcdef1234567'
      const newCommit = 'def7890123456789abcdef1234567890abcdef12345'

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'main',
                commit: oldCommit,
              }),
            }),
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
        { path: 'SKILL.md', content: '# Modified', size: 60 },
      ])
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-different-hash')
      vi.mocked(gitModule.resolveRef).mockResolvedValue({
        source: createGitSource(),
        commitSha: newCommit,
      })

      await runStatus()

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: Array<{ name: string; status: string; modified: boolean; upstream: boolean }>
      }

      expect(data.packages[0]!.status).toBe('both')
      expect(data.packages[0]!.modified).toBe(true)
      expect(data.packages[0]!.upstream).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // --offline flag
  // ---------------------------------------------------------------------------

  describe('--offline flag', () => {
    it('skips upstream ref resolution when --offline is specified', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'main',
                commit: commitSha,
              }),
            }),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-matching-hash',
            }),
          },
        })
      )

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/tmp/project/.agents/skills/test-skill'
      )
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: '# Test', size: 50 },
      ])
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-matching-hash')

      await runStatus('--offline')

      expect(gitModule.resolveRef).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // --json output
  // ---------------------------------------------------------------------------

  describe('--json output', () => {
    it('outputs JSON matching the StatusResult schema', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())

      await runStatus('--offline')

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: unknown[]
        summary: {
          total: number
          upToDate: number
          modified: number
          upstream: number
          unknown: number
        }
      }

      expect(data.packages).toEqual([])
      expect(data.summary).toEqual({
        total: 0,
        upToDate: 0,
        modified: 0,
        upstream: 0,
        unknown: 0,
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Package not found on disk (BROKEN state)
  // ---------------------------------------------------------------------------

  describe('package not found on disk', () => {
    it('handles missing files gracefully without crashing', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'broken-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'main',
                commit: commitSha,
              }),
            }),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'broken-skill': createLockfilePackage({
              integrity: 'sha256-some-hash',
            }),
          },
        })
      )

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(null)

      await runStatus('--offline')

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: Array<{ name: string; status: string }>
      }

      expect(data.packages).toHaveLength(1)
      expect(data.packages[0]!.name).toBe('broken-skill')
    })
  })

  // ---------------------------------------------------------------------------
  // Multiple packages
  // ---------------------------------------------------------------------------

  describe('multiple packages', () => {
    it('reports individual status for each package', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const commit1 = 'abc1234567890abcdef1234567890abcdef1234567'
      const commit2 = 'def4567890abcdef1234567890abcdef123456789a'

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'skill-a': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo-a',
                ref: 'main',
                commit: commit1,
              }),
              agents: ['claude-code'],
            }),
            'skill-b': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo-b',
                ref: 'main',
                commit: commit2,
              }),
              agents: ['cursor'],
            }),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'skill-a': createLockfilePackage({ integrity: 'sha256-hash-a' }),
            'skill-b': createLockfilePackage({ integrity: 'sha256-hash-b' }),
          },
        })
      )

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/tmp/project/.agents/skills/some-skill'
      )
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: '# Test', size: 50 },
      ])
      // skill-a matches, skill-b is modified
      vi.mocked(integrityModule.computeSha256FromFiles)
        .mockReturnValueOnce('sha256-hash-a')
        .mockReturnValueOnce('sha256-hash-b-different')

      await runStatus('--offline')

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: Array<{ name: string; status: string; modified: boolean }>
        summary: { total: number; modified: number }
      }

      expect(data.packages).toHaveLength(2)
      expect(data.summary.total).toBe(2)

      const skillA = data.packages.find((p) => p.name === 'skill-a')
      const skillB = data.packages.find((p) => p.name === 'skill-b')

      expect(skillA!.status).toBe('up-to-date')
      expect(skillA!.modified).toBe(false)
      expect(skillB!.status).toBe('modified')
      expect(skillB!.modified).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  describe('empty state', () => {
    it('shows a clean empty state message when no packages are installed', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())

      await runStatus()

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('No packages installed')
    })
  })

  // ---------------------------------------------------------------------------
  // --global flag
  // ---------------------------------------------------------------------------

  describe('--global flag', () => {
    it('reads manifest and lockfile with global scope', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'global-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'main',
                commit: commitSha,
              }),
            }),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'global-skill': createLockfilePackage({
              integrity: 'sha256-matching-hash',
            }),
          },
        })
      )

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(null)

      await runStatus('--global', '--offline')

      expect(manifestModule.readManifest).toHaveBeenCalledWith(expect.any(String), 'global')
      expect(lockfileModule.readLockfile).toHaveBeenCalledWith(expect.any(String), 'global')

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: Array<{ name: string }>
      }
      expect(data.packages).toHaveLength(1)
      expect(data.packages[0]!.name).toBe('global-skill')
    })
  })

  // ---------------------------------------------------------------------------
  // --all flag
  // ---------------------------------------------------------------------------

  describe('--all flag', () => {
    it('checks both project and global packages with section headers', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      const projectManifest = createManifest({
        packages: {
          'project-skill': createManifestPackage({
            source: createSharedGitSource({
              uri: 'github.com/org/project-repo',
              ref: 'main',
              commit: commitSha,
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
              commit: commitSha,
            }),
          }),
        },
      })

      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(projectManifest)
        .mockReturnValueOnce(globalManifest)

      vi.mocked(lockfileModule.readLockfile)
        .mockReturnValueOnce(createLockfile())
        .mockReturnValueOnce(createLockfile())

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(null)

      await runStatus('--all', '--offline')

      expect(manifestModule.readManifest).toHaveBeenCalledWith(expect.any(String), 'project')
      expect(manifestModule.readManifest).toHaveBeenCalledWith(expect.any(String), 'global')

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('Project skills')
      expect(output).toContain('User skills')
      expect(output).toContain('project-skill')
      expect(output).toContain('shared-skill')
    })

    it('combines all packages in JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(
          createManifest({
            packages: {
              'project-skill': createManifestPackage({
                source: createSharedGitSource({ commit: commitSha }),
              }),
            },
          })
        )
        .mockReturnValueOnce(
          createManifest({
            packages: {
              'global-skill': createManifestPackage({
                source: createSharedGitSource({ commit: commitSha }),
              }),
            },
          })
        )

      vi.mocked(lockfileModule.readLockfile)
        .mockReturnValueOnce(createLockfile())
        .mockReturnValueOnce(createLockfile())

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(null)

      await runStatus('--all', '--offline')

      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: Array<{ name: string }>
        summary: { total: number }
      }

      expect(data.packages).toHaveLength(2)
      expect(data.summary.total).toBe(2)
    })
  })

  // ---------------------------------------------------------------------------
  // AGENT/COMMAND single-file packages
  // ---------------------------------------------------------------------------

  describe('AGENT/COMMAND single-file packages', () => {
    it('reads AGENT package from agent placement path using entryFile', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'deep-research': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'main',
                commit: commitSha,
              }),
              packageType: 'AGENT',
              entryFile: 'deep-research.md',
            }),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'deep-research': createLockfilePackage({
              integrity: 'sha256-agent-hash',
            }),
          },
        })
      )

      vi.mocked(agentDefs.getAgentPlacementPath).mockReturnValue('.claude/agents/deep-research.md')
      vi.mocked(pathsModule.resolvePlacementPath).mockReturnValue(
        '/tmp/project/.claude/agents/deep-research.md'
      )
      vi.mocked(nodeFs.existsSync).mockReturnValue(true)
      vi.mocked(nodeFs.readFileSync).mockReturnValue('# Deep Research Agent')
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-agent-hash')
      vi.mocked(gitModule.resolveRef).mockResolvedValue({ source: createGitSource(), commitSha })

      await runStatus('--offline')

      expect(agentDefs.getAgentPlacementPath).toHaveBeenCalledWith(
        'claude-code',
        'deep-research.md',
        'project'
      )
      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: Array<{ name: string; status: string; modified: boolean }>
      }
      expect(data.packages[0]!.status).toBe('up-to-date')
      expect(data.packages[0]!.modified).toBe(false)
    })

    it('detects modification for COMMAND package', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'pr-commenter': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'main',
                commit: commitSha,
              }),
              packageType: 'COMMAND',
              entryFile: 'pr-commenter.md',
            }),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'pr-commenter': createLockfilePackage({
              integrity: 'sha256-original-hash',
            }),
          },
        })
      )

      vi.mocked(agentDefs.getCommandPlacementPath).mockReturnValue(
        '.claude/commands/pr-commenter.md'
      )
      vi.mocked(pathsModule.resolvePlacementPath).mockReturnValue(
        '/tmp/project/.claude/commands/pr-commenter.md'
      )
      vi.mocked(nodeFs.existsSync).mockReturnValue(true)
      vi.mocked(nodeFs.readFileSync).mockReturnValue('# Modified command')
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-different-hash')
      vi.mocked(gitModule.resolveRef).mockResolvedValue({ source: createGitSource(), commitSha })

      await runStatus('--offline')

      expect(agentDefs.getCommandPlacementPath).toHaveBeenCalledWith(
        'claude-code',
        'pr-commenter.md',
        'project'
      )
      expect(outputModule.outputSuccess).toHaveBeenCalledOnce()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        packages: Array<{ name: string; status: string; modified: boolean }>
      }
      expect(data.packages[0]!.status).toBe('modified')
      expect(data.packages[0]!.modified).toBe(true)
    })

    it('falls back to shortName.md when entryFile is not set', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'my-agent': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'main',
                commit: commitSha,
              }),
              packageType: 'AGENT',
            }),
          },
        })
      )

      vi.mocked(lockfileModule.readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'my-agent': createLockfilePackage({
              integrity: 'sha256-hash',
            }),
          },
        })
      )

      vi.mocked(agentDefs.getAgentPlacementPath).mockReturnValue('.claude/agents/my-agent.md')
      vi.mocked(pathsModule.resolvePlacementPath).mockReturnValue(
        '/tmp/project/.claude/agents/my-agent.md'
      )
      vi.mocked(nodeFs.existsSync).mockReturnValue(true)
      vi.mocked(nodeFs.readFileSync).mockReturnValue('# Agent content')
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-hash')
      vi.mocked(gitModule.resolveRef).mockResolvedValue({ source: createGitSource(), commitSha })

      await runStatus('--offline')

      expect(agentDefs.getAgentPlacementPath).toHaveBeenCalledWith(
        'claude-code',
        'my-agent.md',
        'project'
      )
    })
  })
})
