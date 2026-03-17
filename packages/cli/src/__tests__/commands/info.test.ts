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

describe('info command', () => {
  let readManifest: ReturnType<typeof vi.fn>
  let readLockfile: ReturnType<typeof vi.fn>
  let resolveReadPath: ReturnType<typeof vi.fn>
  let computeSha256FromFiles: ReturnType<typeof vi.fn>
  let readFilesFromDirectory: ReturnType<typeof vi.fn>
  let isJSONMode: ReturnType<typeof vi.fn>
  let outputSuccess: ReturnType<typeof vi.fn>
  let outputError: ReturnType<typeof vi.fn>
  let readFileSync: ReturnType<typeof vi.fn>
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>
  let registerInfoCommand: typeof import('../../commands/info').registerInfoCommand
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
    const integrityModule = await import('../../storage/integrity.js')
    const fetcherModule = await import('../../git/fetcher.js')
    const outputModule = await import('../../output.js')
    const fsModule = await import('node:fs')

    readManifest = vi.mocked(manifestModule.readManifest)
    readLockfile = vi.mocked(lockfileModule.readLockfile)
    resolveReadPath = vi.mocked(canonicalModule.resolveReadPath)
    computeSha256FromFiles = vi.mocked(integrityModule.computeSha256FromFiles)
    readFilesFromDirectory = vi.mocked(fetcherModule.readFilesFromDirectory)
    isJSONMode = vi.mocked(outputModule.isJSONMode)
    outputSuccess = vi.mocked(outputModule.outputSuccess)
    outputError = vi.mocked(outputModule.outputError)
    readFileSync = vi.mocked(fsModule.readFileSync)

    const commanderModule = await import('commander')
    Command = commanderModule.Command

    const infoModule = await import('../../commands/info')
    registerInfoCommand = infoModule.registerInfoCommand
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
      isJSONMode.mockReturnValue(false)

      readManifest.mockReturnValue(
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

      readLockfile.mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-abc123def456',
            }),
          },
        })
      )

      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')

      readFilesFromDirectory.mockResolvedValue([
        { path: 'SKILL.md', content: '# Test', size: 100 },
        { path: 'ref.md', content: '# Ref', size: 50 },
      ])

      computeSha256FromFiles.mockReturnValue('sha256-abc123def456')

      readFileSync.mockImplementation(() => {
        throw new Error('File not found')
      })

      await runInfo('test-skill')

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
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
      isJSONMode.mockReturnValue(false)

      readManifest.mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage(),
          },
        })
      )

      readLockfile.mockReturnValue(createLockfile())

      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')

      readFilesFromDirectory.mockResolvedValue([
        { path: 'SKILL.md', content: createSkillMd(), size: 200 },
      ])

      computeSha256FromFiles.mockReturnValue('sha256-xyz')

      const skillContent = createSkillMd({
        name: 'my-test-skill',
        description: 'A great skill for testing',
      })
      readFileSync.mockReturnValue(skillContent)

      await runInfo('test-skill')

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('my-test-skill')
      expect(output).toContain('A great skill for testing')
    })
  })

  // ---------------------------------------------------------------------------
  // Not installed
  // ---------------------------------------------------------------------------

  describe('not installed', () => {
    it('gives an error with the package name when not installed', async () => {
      isJSONMode.mockReturnValue(false)
      readManifest.mockReturnValue(createManifest())

      await expect(runInfo('nonexistent')).rejects.toThrow()

      expect(exitSpy).toHaveBeenCalledWith(1)
      const output = consoleErrorSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('nonexistent')
      expect(output).toContain('not installed')
    })

    it('outputs JSON error when not installed in JSON mode', async () => {
      isJSONMode.mockReturnValue(true)
      readManifest.mockReturnValue(createManifest())

      await expect(runInfo('nonexistent')).rejects.toThrow()

      expect(outputError).toHaveBeenCalledWith('NOT_FOUND', expect.stringContaining('nonexistent'))
    })
  })

  // ---------------------------------------------------------------------------
  // --json output
  // ---------------------------------------------------------------------------

  describe('--json output', () => {
    it('outputs JSON matching the InfoResult schema', async () => {
      isJSONMode.mockReturnValue(true)

      readManifest.mockReturnValue(
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

      readLockfile.mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-abc123def456',
            }),
          },
        })
      )

      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')

      readFilesFromDirectory.mockResolvedValue([{ path: 'SKILL.md', content: '# Test', size: 100 }])

      computeSha256FromFiles.mockReturnValue('sha256-abc123def456')
      readFileSync.mockImplementation(() => {
        throw new Error('File not found')
      })

      await runInfo('test-skill')

      expect(outputSuccess).toHaveBeenCalledOnce()
      const data = outputSuccess.mock.calls[0]![0] as Record<string, unknown>
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
      isJSONMode.mockReturnValue(false)

      readManifest.mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage(),
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
        { path: 'SKILL.md', content: '# Modified content', size: 120 },
      ])

      computeSha256FromFiles.mockReturnValue('sha256-different-hash')
      readFileSync.mockImplementation(() => {
        throw new Error('File not found')
      })

      await runInfo('test-skill')

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('yes')
    })
  })

  // ---------------------------------------------------------------------------
  // Integrity hash from lockfile
  // ---------------------------------------------------------------------------

  describe('integrity check', () => {
    it('shows the integrity hash from the lockfile', async () => {
      isJSONMode.mockReturnValue(false)

      readManifest.mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage(),
          },
        })
      )

      readLockfile.mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({
              integrity: 'sha256-specificHashValue',
            }),
          },
        })
      )

      resolveReadPath.mockReturnValue('/tmp/project/.agents/skills/test-skill')
      readFilesFromDirectory.mockResolvedValue([])
      readFileSync.mockImplementation(() => {
        throw new Error('File not found')
      })

      await runInfo('test-skill')

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(output).toContain('sha256-specificHashValue')
    })
  })
})
