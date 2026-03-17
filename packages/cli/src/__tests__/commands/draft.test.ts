import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('../../registry/platform.js', () => ({
  platformFetch: vi.fn(),
}))

vi.mock('../../storage/lockfile.js', () => ({
  readLockfile: vi.fn(),
  writeLockfile: vi.fn(),
}))

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn(),
}))

vi.mock('chalk', () => {
  const identity = (s: string) => s
  const fn = Object.assign(identity, {
    red: identity,
    green: identity,
    cyan: identity,
    yellow: identity,
    dim: identity,
    bold: identity,
  })
  return { default: fn }
})

vi.mock('ora', () => {
  const spinner = {
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    text: '',
  }
  return { default: () => spinner }
})

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs'
import { Command } from 'commander'
import { registerDraftCommand } from '../../commands/draft.js'
import { platformFetch } from '../../registry/platform.js'
import { readLockfile, writeLockfile } from '../../storage/lockfile.js'
import { readManifest } from '../../storage/manifest.js'
import {
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createSharedGitSource,
  createSkillMd,
} from '../helpers/fixtures'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerDraftCommand(program)
  return program
}

const VALID_SKILL_MD = createSkillMd({
  name: 'test-skill',
  description: 'A test skill',
  version: '1.0.0',
})

const GIT_SOURCE = createSharedGitSource({
  uri: 'https://github.com/test-org/test-repo',
})

function captureOutput(): { stdout: string[]; stderr: string[] } {
  const stdout: string[] = []
  const stderr: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk))
    return true
  })
  return { stdout, stderr }
}

/** Sets up mocks so resolveSkillIdentity() returns a valid identity. */
function setupIdentity(): void {
  vi.mocked(existsSync).mockReturnValue(true)
  vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
  vi.mocked(readManifest).mockReturnValue(
    createManifest({
      packages: {
        'test-skill': createManifestPackage({ source: GIT_SOURCE }),
      },
    })
  )
}

/** Sets up a lockfile with the skill on the main branch. */
function setupLockfileOnMain(): void {
  vi.mocked(readLockfile).mockReturnValue(
    createLockfile({
      packages: {
        'test-skill': createLockfilePackage({
          source: createSharedGitSource({ ref: 'main', commit: 'abc1234567' }),
        }),
      },
    })
  )
  vi.mocked(writeLockfile).mockReturnValue(undefined)
}

/** Sets up a lockfile with the skill on a draft branch. */
function setupLockfileOnDraft(draftName = 'my-feature'): void {
  vi.mocked(readLockfile).mockReturnValue(
    createLockfile({
      packages: {
        'test-skill': createLockfilePackage({
          source: createSharedGitSource({
            ref: `draft/test-skill/${draftName}`,
            commit: 'abc1234567',
          }),
        }),
      },
    })
  )
  vi.mocked(writeLockfile).mockReturnValue(undefined)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('draft command', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // =========================================================================
  // draft create
  // =========================================================================

  describe('draft create', () => {
    it('creates a draft branch and outputs the result', async () => {
      setupIdentity()
      vi.mocked(platformFetch).mockResolvedValue({
        name: 'my-feature',
        branchName: 'draft/test-skill/my-feature',
      })

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'create', 'my-feature'])

      expect(platformFetch).toHaveBeenCalledWith(
        expect.stringContaining('/drafts'),
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ name: 'my-feature' }),
        })
      )
    })

    it('outputs valid JSON with --json flag', async () => {
      setupIdentity()
      vi.mocked(platformFetch).mockResolvedValue({
        name: 'my-feature',
        branchName: 'draft/test-skill/my-feature',
      })

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'create', 'my-feature', '--json'])

      expect(consoleLogSpy).toHaveBeenCalled()
      const output = JSON.parse(consoleLogSpy.mock.calls[0]![0] as string) as Record<
        string,
        unknown
      >
      expect(output).toHaveProperty('name', 'my-feature')
      expect(output).toHaveProperty('branchName')
    })

    it('exits with error when skill identity cannot be determined', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      vi.mocked(readManifest).mockReturnValue(createManifest({ packages: {} }))
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(
        program.parseAsync(['node', 'agentver', 'draft', 'create', 'my-feature'])
      ).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('Could not determine skill identity')
      expect(platformFetch).not.toHaveBeenCalled()
    })

    it('surfaces API errors from the platform', async () => {
      setupIdentity()
      vi.mocked(platformFetch).mockRejectedValue(
        new Error('Not authenticated. Run `agentver login` to sign in.')
      )

      const program = buildProgram()
      await expect(
        program.parseAsync(['node', 'agentver', 'draft', 'create', 'my-feature'])
      ).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
    })
  })

  // =========================================================================
  // draft list
  // =========================================================================

  describe('draft list', () => {
    it('lists open drafts from the platform', async () => {
      setupIdentity()
      const { stdout } = captureOutput()
      vi.mocked(platformFetch).mockResolvedValue([
        {
          name: 'feature-a',
          branchName: 'draft/test-skill/feature-a',
          latestCommitId: 'abc1234567',
          latestMessage: 'Add new prompt',
        },
        {
          name: 'feature-b',
          branchName: 'draft/test-skill/feature-b',
          latestCommitId: 'def7890123',
          latestMessage: 'Fix wording',
        },
      ])

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'list'])

      expect(platformFetch).toHaveBeenCalledWith(expect.stringContaining('/drafts'))
      expect(stdout.join('')).toContain('feature-a')
      expect(stdout.join('')).toContain('feature-b')
    })

    it('displays a message when there are no drafts', async () => {
      setupIdentity()
      const { stdout } = captureOutput()
      vi.mocked(platformFetch).mockResolvedValue([])

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'list'])

      expect(stdout.join('')).toContain('No open drafts')
    })

    it('outputs valid JSON with --json flag', async () => {
      setupIdentity()
      vi.mocked(platformFetch).mockResolvedValue([
        {
          name: 'feature-a',
          branchName: 'draft/test-skill/feature-a',
          latestCommitId: 'abc1234567',
          latestMessage: 'Add new prompt',
        },
      ])

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'list', '--json'])

      expect(consoleLogSpy).toHaveBeenCalled()
      const output = JSON.parse(consoleLogSpy.mock.calls[0]![0] as string) as Record<
        string,
        unknown
      >
      expect(output).toHaveProperty('drafts')
      expect(Array.isArray(output.drafts)).toBe(true)
    })

    it('exits with error when skill identity cannot be determined', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      vi.mocked(readManifest).mockReturnValue(createManifest({ packages: {} }))
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'draft', 'list'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('Could not determine skill identity')
    })

    it('surfaces authentication errors', async () => {
      setupIdentity()
      vi.mocked(platformFetch).mockRejectedValue(
        new Error('Not authenticated. Run `agentver login` to sign in.')
      )

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'draft', 'list'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
    })
  })

  // =========================================================================
  // draft switch
  // =========================================================================

  describe('draft switch', () => {
    it('updates the lockfile ref to the draft branch', async () => {
      setupIdentity()
      setupLockfileOnMain()

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'switch', 'my-feature'])

      expect(writeLockfile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          packages: expect.objectContaining({
            'test-skill': expect.objectContaining({
              source: expect.objectContaining({
                ref: 'draft/test-skill/my-feature',
              }),
            }),
          }),
        })
      )
    })

    it('outputs a confirmation message with the new ref', async () => {
      setupIdentity()
      setupLockfileOnMain()
      const { stdout } = captureOutput()

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'switch', 'my-feature'])

      expect(stdout.join('')).toContain('draft/test-skill/my-feature')
    })

    it('outputs valid JSON with --json flag', async () => {
      setupIdentity()
      setupLockfileOnMain()

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'switch', 'my-feature', '--json'])

      expect(consoleLogSpy).toHaveBeenCalled()
      const output = JSON.parse(consoleLogSpy.mock.calls[0]![0] as string) as Record<
        string,
        unknown
      >
      expect(output).toHaveProperty('skill')
      expect(output).toHaveProperty('draft', 'my-feature')
      expect(output).toHaveProperty('ref', 'draft/test-skill/my-feature')
    })

    it('exits with error when skill is not in the lockfile', async () => {
      setupIdentity()
      vi.mocked(readLockfile).mockReturnValue(createLockfile({ packages: {} }))
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(
        program.parseAsync(['node', 'agentver', 'draft', 'switch', 'my-feature'])
      ).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('not found in lockfile')
    })

    it('exits with error when skill identity cannot be determined', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      vi.mocked(readManifest).mockReturnValue(createManifest({ packages: {} }))
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(
        program.parseAsync(['node', 'agentver', 'draft', 'switch', 'my-feature'])
      ).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('Could not determine skill identity')
    })
  })

  // =========================================================================
  // draft publish
  // =========================================================================

  describe('draft publish', () => {
    it('merges the current draft to main and updates the lockfile', async () => {
      setupIdentity()
      setupLockfileOnDraft('my-feature')
      vi.mocked(platformFetch).mockResolvedValue({ commitSha: 'merged123abc' })

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'publish'])

      expect(platformFetch).toHaveBeenCalledWith(
        expect.stringContaining('/drafts'),
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            action: 'merge',
            branchName: 'draft/test-skill/my-feature',
          }),
        })
      )
      expect(writeLockfile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          packages: expect.objectContaining({
            'test-skill': expect.objectContaining({
              source: expect.objectContaining({
                ref: 'main',
                commit: 'merged123abc',
              }),
            }),
          }),
        })
      )
    })

    it('exits with error when not on a draft branch', async () => {
      setupIdentity()
      setupLockfileOnMain()
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'draft', 'publish'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('Not on a draft branch')
      expect(platformFetch).not.toHaveBeenCalled()
    })

    it('outputs valid JSON with --json flag', async () => {
      setupIdentity()
      setupLockfileOnDraft('my-feature')
      vi.mocked(platformFetch).mockResolvedValue({ commitSha: 'merged123abc' })

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'publish', '--json'])

      expect(consoleLogSpy).toHaveBeenCalled()
      const output = JSON.parse(consoleLogSpy.mock.calls[0]![0] as string) as Record<
        string,
        unknown
      >
      expect(output).toHaveProperty('merged', true)
      expect(output).toHaveProperty('commitSha', 'merged123abc')
      expect(output).toHaveProperty('ref', 'main')
    })

    it('exits with error when skill identity cannot be determined', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      vi.mocked(readManifest).mockReturnValue(createManifest({ packages: {} }))
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'draft', 'publish'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('Could not determine skill identity')
    })

    it('exits with error when skill is not in the lockfile', async () => {
      setupIdentity()
      vi.mocked(readLockfile).mockReturnValue(createLockfile({ packages: {} }))
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'draft', 'publish'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('Skill not found in lockfile')
    })

    it('surfaces authentication errors from the platform', async () => {
      setupIdentity()
      setupLockfileOnDraft('my-feature')
      vi.mocked(platformFetch).mockRejectedValue(
        new Error('Not authenticated. Run `agentver login` to sign in.')
      )

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'draft', 'publish'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
    })
  })

  // =========================================================================
  // draft discard
  // =========================================================================

  describe('draft discard', () => {
    it('deletes the current draft and switches lockfile back to main', async () => {
      setupIdentity()
      setupLockfileOnDraft('my-feature')
      vi.mocked(platformFetch).mockResolvedValue({})

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'discard'])

      expect(platformFetch).toHaveBeenCalledWith(
        expect.stringContaining('/drafts'),
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            action: 'delete',
            branchName: 'draft/test-skill/my-feature',
          }),
        })
      )
      expect(writeLockfile).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          packages: expect.objectContaining({
            'test-skill': expect.objectContaining({
              source: expect.objectContaining({
                ref: 'main',
              }),
            }),
          }),
        })
      )
    })

    it('exits with error when not on a draft branch', async () => {
      setupIdentity()
      setupLockfileOnMain()
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'draft', 'discard'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('Not on a draft branch')
      expect(platformFetch).not.toHaveBeenCalled()
    })

    it('outputs valid JSON with --json flag', async () => {
      setupIdentity()
      setupLockfileOnDraft('my-feature')
      vi.mocked(platformFetch).mockResolvedValue({})

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'discard', '--json'])

      expect(consoleLogSpy).toHaveBeenCalled()
      const output = JSON.parse(consoleLogSpy.mock.calls[0]![0] as string) as Record<
        string,
        unknown
      >
      expect(output).toHaveProperty('discarded', true)
      expect(output).toHaveProperty('previousRef', 'draft/test-skill/my-feature')
      expect(output).toHaveProperty('ref', 'main')
    })

    it('exits with error when skill identity cannot be determined', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      vi.mocked(readManifest).mockReturnValue(createManifest({ packages: {} }))
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'draft', 'discard'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('Could not determine skill identity')
    })

    it('exits with error when skill is not in the lockfile', async () => {
      setupIdentity()
      vi.mocked(readLockfile).mockReturnValue(createLockfile({ packages: {} }))
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'draft', 'discard'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('Skill not found in lockfile')
    })

    it('surfaces authentication errors from the platform', async () => {
      setupIdentity()
      setupLockfileOnDraft('my-feature')
      vi.mocked(platformFetch).mockRejectedValue(
        new Error('Not authenticated. Run `agentver login` to sign in.')
      )

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'draft', 'discard'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('surfaces connection errors when no platform URL is configured', async () => {
      setupIdentity()
      setupLockfileOnDraft('my-feature')
      vi.mocked(platformFetch).mockRejectedValue(
        new Error('No platform URL configured. Run `agentver login <url>` to connect.')
      )

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'draft', 'discard'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
    })
  })
})
