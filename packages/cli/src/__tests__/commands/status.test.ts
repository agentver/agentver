import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createSharedGitSource,
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

vi.mock('../../git/index.js', () => ({
  resolveRef: vi.fn(),
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

describe('status command', () => {
  let readManifest: ReturnType<typeof vi.fn>
  let readLockfile: ReturnType<typeof vi.fn>
  let resolveReadPath: ReturnType<typeof vi.fn>
  let computeSha256FromFiles: ReturnType<typeof vi.fn>
  let readFilesFromDirectory: ReturnType<typeof vi.fn>
  let resolveRef: ReturnType<typeof vi.fn>
  let isJSONMode: ReturnType<typeof vi.fn>
  let outputSuccess: ReturnType<typeof vi.fn>
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let registerStatusCommand: typeof import('../../commands/status').registerStatusCommand
  let Command: typeof import('commander').Command

  beforeEach(async () => {
    vi.clearAllMocks()

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const manifestModule = await import('../../storage/manifest.js')
    const lockfileModule = await import('../../storage/lockfile.js')
    const canonicalModule = await import('../../storage/canonical.js')
    const integrityModule = await import('../../storage/integrity.js')
    const fetcherModule = await import('../../git/fetcher.js')
    const gitModule = await import('../../git/index.js')
    const outputModule = await import('../../output')

    readManifest = vi.mocked(manifestModule.readManifest)
    readLockfile = vi.mocked(lockfileModule.readLockfile)
    resolveReadPath = vi.mocked(canonicalModule.resolveReadPath)
    computeSha256FromFiles = vi.mocked(integrityModule.computeSha256FromFiles)
    readFilesFromDirectory = vi.mocked(fetcherModule.readFilesFromDirectory)
    resolveRef = vi.mocked(gitModule.resolveRef)
    isJSONMode = vi.mocked(outputModule.isJSONMode)
    outputSuccess = vi.mocked(outputModule.outputSuccess)

    const commanderModule = await import('commander')
    Command = commanderModule.Command

    const statusModule = await import('../../commands/status')
    registerStatusCommand = statusModule.registerStatusCommand
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
      isJSONMode.mockReturnValue(false)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      readManifest.mockReturnValue(
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

      readLockfile.mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-matching-hash',
            }),
          },
        })
      )

      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')
      readFilesFromDirectory.mockResolvedValue([{ path: 'SKILL.md', content: '# Test', size: 50 }])
      computeSha256FromFiles.mockReturnValue('sha256-matching-hash')
      resolveRef.mockResolvedValue({ source: {}, commitSha })

      await runStatus()

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('test-skill')
    })
  })

  // ---------------------------------------------------------------------------
  // Locally modified
  // ---------------------------------------------------------------------------

  describe('locally modified', () => {
    it('shows MODIFIED status when local files differ from lockfile hash', async () => {
      isJSONMode.mockReturnValue(true)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      readManifest.mockReturnValue(
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

      readLockfile.mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-original-hash',
            }),
          },
        })
      )

      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')
      readFilesFromDirectory.mockResolvedValue([
        { path: 'SKILL.md', content: '# Modified', size: 60 },
      ])
      computeSha256FromFiles.mockReturnValue('sha256-different-hash')
      resolveRef.mockResolvedValue({ source: {}, commitSha })

      await runStatus('--offline')

      expect(outputSuccess).toHaveBeenCalledOnce()
      const data = outputSuccess.mock.calls[0]![0] as {
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
      isJSONMode.mockReturnValue(true)

      const oldCommit = 'abc1234567890abcdef1234567890abcdef1234567'
      const newCommit = 'def7890123456789abcdef1234567890abcdef12345'

      readManifest.mockReturnValue(
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

      readLockfile.mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-matching-hash',
            }),
          },
        })
      )

      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')
      readFilesFromDirectory.mockResolvedValue([{ path: 'SKILL.md', content: '# Test', size: 50 }])
      computeSha256FromFiles.mockReturnValue('sha256-matching-hash')
      resolveRef.mockResolvedValue({ source: {}, commitSha: newCommit })

      await runStatus()

      expect(outputSuccess).toHaveBeenCalledOnce()
      const data = outputSuccess.mock.calls[0]![0] as {
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
      isJSONMode.mockReturnValue(true)

      const oldCommit = 'abc1234567890abcdef1234567890abcdef1234567'
      const newCommit = 'def7890123456789abcdef1234567890abcdef12345'

      readManifest.mockReturnValue(
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

      readLockfile.mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-original-hash',
            }),
          },
        })
      )

      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')
      readFilesFromDirectory.mockResolvedValue([
        { path: 'SKILL.md', content: '# Modified', size: 60 },
      ])
      computeSha256FromFiles.mockReturnValue('sha256-different-hash')
      resolveRef.mockResolvedValue({ source: {}, commitSha: newCommit })

      await runStatus()

      expect(outputSuccess).toHaveBeenCalledOnce()
      const data = outputSuccess.mock.calls[0]![0] as {
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
      isJSONMode.mockReturnValue(true)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      readManifest.mockReturnValue(
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

      readLockfile.mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-matching-hash',
            }),
          },
        })
      )

      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')
      readFilesFromDirectory.mockResolvedValue([{ path: 'SKILL.md', content: '# Test', size: 50 }])
      computeSha256FromFiles.mockReturnValue('sha256-matching-hash')

      await runStatus('--offline')

      expect(resolveRef).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // --json output
  // ---------------------------------------------------------------------------

  describe('--json output', () => {
    it('outputs JSON matching the StatusResult schema', async () => {
      isJSONMode.mockReturnValue(true)

      readManifest.mockReturnValue(createManifest())
      readLockfile.mockReturnValue(createLockfile())

      await runStatus('--offline')

      expect(outputSuccess).toHaveBeenCalledOnce()
      const data = outputSuccess.mock.calls[0]![0] as {
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
      isJSONMode.mockReturnValue(true)

      const commitSha = 'abc1234567890abcdef1234567890abcdef1234567'

      readManifest.mockReturnValue(
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

      readLockfile.mockReturnValue(
        createLockfile({
          packages: {
            'broken-skill': createLockfilePackage({
              integrity: 'sha256-some-hash',
            }),
          },
        })
      )

      resolveReadPath.mockReturnValue(null)

      await runStatus('--offline')

      expect(outputSuccess).toHaveBeenCalledOnce()
      const data = outputSuccess.mock.calls[0]![0] as {
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
      isJSONMode.mockReturnValue(true)

      const commit1 = 'abc1234567890abcdef1234567890abcdef1234567'
      const commit2 = 'def4567890abcdef1234567890abcdef123456789a'

      readManifest.mockReturnValue(
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

      readLockfile.mockReturnValue(
        createLockfile({
          packages: {
            'skill-a': createLockfilePackage({ integrity: 'sha256-hash-a' }),
            'skill-b': createLockfilePackage({ integrity: 'sha256-hash-b' }),
          },
        })
      )

      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/some-skill')
      readFilesFromDirectory.mockResolvedValue([{ path: 'SKILL.md', content: '# Test', size: 50 }])
      // skill-a matches, skill-b is modified
      computeSha256FromFiles
        .mockReturnValueOnce('sha256-hash-a')
        .mockReturnValueOnce('sha256-hash-b-different')

      await runStatus('--offline')

      expect(outputSuccess).toHaveBeenCalledOnce()
      const data = outputSuccess.mock.calls[0]![0] as {
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
      isJSONMode.mockReturnValue(false)
      readManifest.mockReturnValue(createManifest())
      readLockfile.mockReturnValue(createLockfile())

      await runStatus()

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('No packages installed')
    })
  })
})
