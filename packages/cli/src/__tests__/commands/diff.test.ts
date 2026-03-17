import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createSharedGitSource,
  createWellKnownSource,
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

vi.mock('../../git/fetcher.js', () => ({
  readFilesFromDirectory: vi.fn(),
}))

vi.mock('../../git/index.js', () => ({
  fetchFiles: vi.fn(),
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

describe('diff command', () => {
  let readManifest: ReturnType<typeof vi.fn>
  let readLockfile: ReturnType<typeof vi.fn>
  let resolveReadPath: ReturnType<typeof vi.fn>
  let readFilesFromDirectory: ReturnType<typeof vi.fn>
  let fetchFiles: ReturnType<typeof vi.fn>
  let isJSONMode: ReturnType<typeof vi.fn>
  let outputSuccess: ReturnType<typeof vi.fn>
  let outputError: ReturnType<typeof vi.fn>
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>
  let registerDiffCommand: typeof import('../../commands/diff').registerDiffCommand
  let Command: typeof import('commander').Command

  beforeEach(async () => {
    vi.clearAllMocks()

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    const manifestModule = await import('../../storage/manifest.js')
    const lockfileModule = await import('../../storage/lockfile.js')
    const canonicalModule = await import('../../storage/canonical.js')
    const fetcherModule = await import('../../git/fetcher.js')
    const gitModule = await import('../../git/index.js')
    const outputModule = await import('../../output')

    readManifest = vi.mocked(manifestModule.readManifest)
    readLockfile = vi.mocked(lockfileModule.readLockfile)
    resolveReadPath = vi.mocked(canonicalModule.resolveReadPath)
    readFilesFromDirectory = vi.mocked(fetcherModule.readFilesFromDirectory)
    fetchFiles = vi.mocked(gitModule.fetchFiles)
    isJSONMode = vi.mocked(outputModule.isJSONMode)
    outputSuccess = vi.mocked(outputModule.outputSuccess)
    outputError = vi.mocked(outputModule.outputError)

    const commanderModule = await import('commander')
    Command = commanderModule.Command

    const diffModule = await import('../../commands/diff')
    registerDiffCommand = diffModule.registerDiffCommand
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createProgram(): InstanceType<typeof Command> {
    const program = new Command()
    program.exitOverride()
    registerDiffCommand(program)
    return program
  }

  async function runDiff(...args: string[]): Promise<void> {
    const program = createProgram()
    await program.parseAsync(['node', 'agentver', 'diff', ...args])
  }

  const COMMIT_SHA = 'abc1234567890abcdef1234567890abcdef1234567'

  function setupInstalledPackage(
    name: string,
    overrides?: {
      sourceUri?: string
      commit?: string
      lockfileCommit?: string
    }
  ): void {
    const uri = overrides?.sourceUri ?? 'github.com/org/repo'
    const commit = overrides?.commit ?? COMMIT_SHA

    readManifest.mockReturnValue(
      createManifest({
        packages: {
          [name]: createManifestPackage({
            source: createSharedGitSource({
              uri,
              ref: 'main',
              commit,
              path: '',
            }),
            agents: ['claude-code'],
          }),
        },
      })
    )

    readLockfile.mockReturnValue(
      createLockfile({
        packages: {
          [name]: createLockfilePackage({
            source: createSharedGitSource({
              uri,
              ref: 'main',
              commit: overrides?.lockfileCommit ?? commit,
            }),
          }),
        },
      })
    )
  }

  // ---------------------------------------------------------------------------
  // Happy path — local files differ from upstream
  // ---------------------------------------------------------------------------

  describe('happy path', () => {
    it('shows unified diff when local files differ from upstream', async () => {
      isJSONMode.mockReturnValue(false)

      setupInstalledPackage('test-skill')
      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')

      fetchFiles.mockResolvedValue({
        files: [{ path: 'SKILL.md', content: 'line 1\nline 2\nline 3\n', size: 20 }],
        commitSha: COMMIT_SHA,
        source: {},
      })

      readFilesFromDirectory.mockResolvedValue([
        { path: 'SKILL.md', content: 'line 1\nline 2 modified\nline 3\n', size: 25 },
      ])

      await runDiff('test-skill')

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('SKILL.md')
      expect(output).toContain('-line 2')
      expect(output).toContain('+line 2 modified')
    })
  })

  // ---------------------------------------------------------------------------
  // No differences
  // ---------------------------------------------------------------------------

  describe('no differences', () => {
    it('shows a clean message when local matches upstream', async () => {
      isJSONMode.mockReturnValue(false)

      setupInstalledPackage('test-skill')
      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')

      const content = 'line 1\nline 2\nline 3\n'

      fetchFiles.mockResolvedValue({
        files: [{ path: 'SKILL.md', content, size: content.length }],
        commitSha: COMMIT_SHA,
        source: {},
      })

      readFilesFromDirectory.mockResolvedValue([
        { path: 'SKILL.md', content, size: content.length },
      ])

      await runDiff('test-skill')

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('No differences')
    })
  })

  // ---------------------------------------------------------------------------
  // Not installed
  // ---------------------------------------------------------------------------

  describe('not installed', () => {
    it('errors when the package is not in the manifest', async () => {
      isJSONMode.mockReturnValue(false)
      readManifest.mockReturnValue(createManifest())
      readLockfile.mockReturnValue(createLockfile())

      await expect(runDiff('nonexistent')).rejects.toThrow()

      expect(exitSpy).toHaveBeenCalledWith(1)
      const output = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('nonexistent')
      expect(output).toContain('not installed')
    })

    it('outputs JSON error when not installed in JSON mode', async () => {
      isJSONMode.mockReturnValue(true)
      readManifest.mockReturnValue(createManifest())
      readLockfile.mockReturnValue(createLockfile())

      await expect(runDiff('nonexistent')).rejects.toThrow()

      expect(outputError).toHaveBeenCalledWith(
        'NOT_INSTALLED',
        expect.stringContaining('nonexistent')
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Multiple changed files
  // ---------------------------------------------------------------------------

  describe('multiple changed files', () => {
    it('shows diff spanning several files correctly', async () => {
      isJSONMode.mockReturnValue(false)

      setupInstalledPackage('test-skill')
      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')

      fetchFiles.mockResolvedValue({
        files: [
          { path: 'SKILL.md', content: 'original skill\n', size: 15 },
          { path: 'refs/helper.md', content: 'original helper\n', size: 16 },
        ],
        commitSha: COMMIT_SHA,
        source: {},
      })

      readFilesFromDirectory.mockResolvedValue([
        { path: 'SKILL.md', content: 'modified skill\n', size: 15 },
        { path: 'refs/helper.md', content: 'modified helper\n', size: 16 },
      ])

      await runDiff('test-skill')

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('SKILL.md')
      expect(output).toContain('refs/helper.md')
    })
  })

  // ---------------------------------------------------------------------------
  // Added file
  // ---------------------------------------------------------------------------

  describe('added file', () => {
    it('shows new files in local as additions', async () => {
      isJSONMode.mockReturnValue(false)

      setupInstalledPackage('test-skill')
      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')

      fetchFiles.mockResolvedValue({
        files: [{ path: 'SKILL.md', content: 'original\n', size: 9 }],
        commitSha: COMMIT_SHA,
        source: {},
      })

      readFilesFromDirectory.mockResolvedValue([
        { path: 'SKILL.md', content: 'original\n', size: 9 },
        { path: 'new-file.md', content: 'new content\n', size: 12 },
      ])

      await runDiff('test-skill')

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('new-file.md')
      expect(output).toContain('+new content')
    })
  })

  // ---------------------------------------------------------------------------
  // Deleted file
  // ---------------------------------------------------------------------------

  describe('deleted file', () => {
    it('shows files removed from local as deletions', async () => {
      isJSONMode.mockReturnValue(false)

      setupInstalledPackage('test-skill')
      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')

      fetchFiles.mockResolvedValue({
        files: [
          { path: 'SKILL.md', content: 'original\n', size: 9 },
          { path: 'deleted.md', content: 'to be deleted\n', size: 14 },
        ],
        commitSha: COMMIT_SHA,
        source: {},
      })

      readFilesFromDirectory.mockResolvedValue([
        { path: 'SKILL.md', content: 'original\n', size: 9 },
      ])

      await runDiff('test-skill')

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('deleted.md')
      expect(output).toContain('-to be deleted')
    })
  })

  // ---------------------------------------------------------------------------
  // --json output
  // ---------------------------------------------------------------------------

  describe('--json output', () => {
    it('outputs JSON matching the DiffResult schema', async () => {
      isJSONMode.mockReturnValue(true)

      setupInstalledPackage('test-skill')
      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')

      fetchFiles.mockResolvedValue({
        files: [{ path: 'SKILL.md', content: 'line 1\nline 2\n', size: 13 }],
        commitSha: COMMIT_SHA,
        source: {},
      })

      readFilesFromDirectory.mockResolvedValue([
        { path: 'SKILL.md', content: 'line 1\nline 2 changed\n', size: 20 },
      ])

      await runDiff('test-skill')

      expect(outputSuccess).toHaveBeenCalledOnce()
      const data = outputSuccess.mock.calls[0]![0] as {
        name: string
        hunks: Array<{ file: string; additions: number; deletions: number; content: string }>
      }

      expect(data.name).toBe('test-skill')
      expect(data.hunks).toHaveLength(1)
      expect(data.hunks[0]!.file).toBe('SKILL.md')
      expect(data.hunks[0]!.additions).toBeGreaterThan(0)
      expect(data.hunks[0]!.deletions).toBeGreaterThan(0)
    })

    it('outputs empty hunks when no differences exist', async () => {
      isJSONMode.mockReturnValue(true)

      setupInstalledPackage('test-skill')
      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')

      const content = 'identical content\n'

      fetchFiles.mockResolvedValue({
        files: [{ path: 'SKILL.md', content, size: content.length }],
        commitSha: COMMIT_SHA,
        source: {},
      })

      readFilesFromDirectory.mockResolvedValue([
        { path: 'SKILL.md', content, size: content.length },
      ])

      await runDiff('test-skill')

      expect(outputSuccess).toHaveBeenCalledOnce()
      const data = outputSuccess.mock.calls[0]![0] as {
        name: string
        hunks: unknown[]
      }

      expect(data.name).toBe('test-skill')
      expect(data.hunks).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Well-known source (unsupported)
  // ---------------------------------------------------------------------------

  describe('well-known source', () => {
    it('errors for well-known source packages', async () => {
      isJSONMode.mockReturnValue(false)

      readManifest.mockReturnValue(
        createManifest({
          packages: {
            'wk-skill': createManifestPackage({
              source: createWellKnownSource(),
            }),
          },
        })
      )
      readLockfile.mockReturnValue(createLockfile())

      await expect(runDiff('wk-skill')).rejects.toThrow()

      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })
})
