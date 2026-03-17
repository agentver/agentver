import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createManifest, createManifestPackage, createSharedGitSource } from '../helpers/fixtures'

vi.mock('../../registry/platform.js', () => ({
  platformFetch: vi.fn(),
}))

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn(),
}))

vi.mock('ora', () => ({
  default: vi.fn(() => ({
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
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  }
})

describe('log command', () => {
  let platformFetch: ReturnType<typeof vi.fn>
  let readManifest: ReturnType<typeof vi.fn>
  let existsSync: ReturnType<typeof vi.fn>
  let _readFileSync: ReturnType<typeof vi.fn>
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>
  let registerLogCommand: typeof import('../../commands/log').registerLogCommand
  let Command: typeof import('commander').Command

  beforeEach(async () => {
    vi.clearAllMocks()

    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    const platformModule = await import('../../registry/platform.js')
    const manifestModule = await import('../../storage/manifest.js')
    const fsModule = await import('node:fs')

    platformFetch = vi.mocked(platformModule.platformFetch)
    readManifest = vi.mocked(manifestModule.readManifest)
    existsSync = vi.mocked(fsModule.existsSync)
    _readFileSync = vi.mocked(fsModule.readFileSync)

    const commanderModule = await import('commander')
    Command = commanderModule.Command

    const logModule = await import('../../commands/log')
    registerLogCommand = logModule.registerLogCommand
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createProgram(): InstanceType<typeof Command> {
    const program = new Command()
    program.exitOverride()
    registerLogCommand(program)
    return program
  }

  async function runLog(...args: string[]): Promise<void> {
    const program = createProgram()
    await program.parseAsync(['node', 'agentver', 'log', ...args])
  }

  // ---------------------------------------------------------------------------
  // Happy path — fetches commit history from platform
  // ---------------------------------------------------------------------------

  describe('happy path', () => {
    it('fetches commit history and displays with dates and short SHAs', async () => {
      readManifest.mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
                ref: 'main',
                commit: 'abc1234567890',
              }),
            }),
          },
        })
      )

      platformFetch.mockResolvedValue([
        {
          sha: 'abc1234567890abcdef1234567890abcdef1234567',
          message: 'Initial commit',
          author: { name: 'Test Author', email: 'test@test.com', date: '2025-01-15T10:30:00Z' },
          createdAt: '2025-01-15T10:30:00Z',
        },
        {
          sha: 'def7890123456789abcdef1234567890abcdef1234',
          message: 'Add feature',
          author: { name: 'Test Author', email: 'test@test.com', date: '2025-01-16T12:00:00Z' },
          createdAt: '2025-01-16T12:00:00Z',
        },
      ])

      await runLog('test-skill')

      const output = stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('')
      expect(output).toContain('abc1234')
      expect(output).toContain('Initial commit')
      expect(output).toContain('def7890')
      expect(output).toContain('Add feature')
      expect(output).toContain('History for')
    })
  })

  // ---------------------------------------------------------------------------
  // --limit flag
  // ---------------------------------------------------------------------------

  describe('--limit flag', () => {
    it('requests only the specified number of entries', async () => {
      readManifest.mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
              }),
            }),
          },
        })
      )

      platformFetch.mockResolvedValue([])

      await runLog('test-skill', '--limit', '5')

      expect(platformFetch).toHaveBeenCalledOnce()
      const callPath = platformFetch.mock.calls[0]![0] as string
      expect(callPath).toContain('limit=5')
    })
  })

  // ---------------------------------------------------------------------------
  // Empty history
  // ---------------------------------------------------------------------------

  describe('empty history', () => {
    it('shows a clean message when no commits are found', async () => {
      readManifest.mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
              }),
            }),
          },
        })
      )

      platformFetch.mockResolvedValue([])

      await runLog('test-skill')

      const output = stdoutWriteSpy.mock.calls.map((c) => String(c[0])).join('')
      expect(output).toContain('No commits found')
    })
  })

  // ---------------------------------------------------------------------------
  // Not authenticated / no platform
  // ---------------------------------------------------------------------------

  describe('not authenticated', () => {
    it('exits with an error when platformFetch throws an auth error', async () => {
      readManifest.mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
              }),
            }),
          },
        })
      )

      platformFetch.mockRejectedValue(
        new Error('Not authenticated. Run `agentver login` to sign in.')
      )

      await expect(runLog('test-skill')).rejects.toThrow()
      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  describe('no platform', () => {
    it('exits with an error when platformFetch throws a no-URL error', async () => {
      readManifest.mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
              }),
            }),
          },
        })
      )

      platformFetch.mockRejectedValue(
        new Error('No platform URL configured. Run `agentver login <url>` to connect.')
      )

      await expect(runLog('test-skill')).rejects.toThrow()
      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  // ---------------------------------------------------------------------------
  // --json output
  // ---------------------------------------------------------------------------

  describe('--json output', () => {
    it('outputs JSON with commits array', async () => {
      readManifest.mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/org/repo',
              }),
            }),
          },
        })
      )

      const commits = [
        {
          sha: 'abc1234567890abcdef1234567890abcdef1234567',
          message: 'First commit',
          author: { name: 'Author', email: 'a@b.com', date: '2025-01-15T10:30:00Z' },
          createdAt: '2025-01-15T10:30:00Z',
        },
      ]

      platformFetch.mockResolvedValue(commits)

      await runLog('test-skill', '--json')

      expect(consoleSpy).toHaveBeenCalledOnce()
      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string) as {
        commits: Array<{ sha: string; message: string }>
      }

      expect(output.commits).toHaveLength(1)
      expect(output.commits[0]!.sha).toBe('abc1234567890abcdef1234567890abcdef1234567')
      expect(output.commits[0]!.message).toBe('First commit')
    })
  })

  // ---------------------------------------------------------------------------
  // Skill identity resolution
  // ---------------------------------------------------------------------------

  describe('skill identity resolution', () => {
    it('errors when skill identity cannot be determined', async () => {
      readManifest.mockReturnValue(createManifest())

      // No name argument and no SKILL.md in cwd
      existsSync.mockReturnValue(false)

      await expect(runLog()).rejects.toThrow()
      expect(exitSpy).toHaveBeenCalledWith(1)

      const output = stderrWriteSpy.mock.calls.map((c) => String(c[0])).join('')
      expect(output).toContain('Could not determine skill identity')
    })

    it('resolves org/name from manifest entry URI', async () => {
      readManifest.mockReturnValue(
        createManifest({
          packages: {
            'my-skill': createManifestPackage({
              source: createSharedGitSource({
                uri: 'github.com/my-org/my-repo',
                ref: 'main',
                commit: 'abc1234567890',
              }),
            }),
          },
        })
      )

      platformFetch.mockResolvedValue([])

      await runLog('my-skill')

      expect(platformFetch).toHaveBeenCalledOnce()
      const callPath = platformFetch.mock.calls[0]![0] as string
      expect(callPath).toContain('@my-org')
      expect(callPath).toContain('my-skill')
    })
  })
})
