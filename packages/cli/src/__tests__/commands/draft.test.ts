import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('../../registry/platform.js', () => ({
  platformFetch: vi.fn(),
}))

vi.mock('../../storage/lockfile.js', () => ({
  readLockfile: vi.fn(),
}))

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn(),
}))

vi.mock('../../storage/pair.js', () => ({
  updateManifestAndLockfile: vi.fn(),
}))

vi.mock('../../storage/canonical.js', () => ({
  getCanonicalSkillPath: vi.fn().mockReturnValue('/project/.agents/skills/test-skill'),
}))

vi.mock('../../storage/integrity.js', async () => {
  const actual = await vi.importActual<typeof import('../../storage/integrity.js')>(
    '../../storage/integrity.js'
  )
  return {
    ...actual,
    deriveCommitFromIntegrity: vi.fn().mockReturnValue('draftcommit1234567890'),
  }
})

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

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs'
import { Command } from 'commander'
import { registerDraftCommand } from '../../commands/draft.js'
import * as outputModule from '../../output.js'
import { platformFetch } from '../../registry/platform.js'
import { readLockfile } from '../../storage/lockfile.js'
import { readManifest } from '../../storage/manifest.js'
import { updateManifestAndLockfile } from '../../storage/pair.js'
import {
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createSharedGitSource,
  createSkillMd,
} from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

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
  vi.mocked(updateManifestAndLockfile).mockImplementation((_projectRoot, _scope, updater) => {
    const manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage({ source: createSharedGitSource({ ref: 'main' }) }),
      },
    })
    const lockfile = createLockfile({
      packages: {
        'test-skill': createLockfilePackage({
          source: createSharedGitSource({ ref: 'main', commit: 'abc1234567' }),
        }),
      },
    })
    return updater(manifest, lockfile)
  })
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
  vi.mocked(updateManifestAndLockfile).mockImplementation((_projectRoot, _scope, updater) => {
    const manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage({
          source: createSharedGitSource({
            ref: `draft/test-skill/${draftName}`,
            commit: 'abc1234567',
          }),
        }),
      },
    })
    const lockfile = createLockfile({
      packages: {
        'test-skill': createLockfilePackage({
          source: createSharedGitSource({
            ref: `draft/test-skill/${draftName}`,
            commit: 'abc1234567',
          }),
        }),
      },
    })
    return updater(manifest, lockfile)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('draft command', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)
    vi.mocked(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
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

      const mockedOutputSuccess = vi.mocked(outputModule.outputSuccess)
      expect(mockedOutputSuccess).toHaveBeenCalledOnce()
      const data = mockedOutputSuccess.mock.calls[0]![0] as Record<string, unknown>
      expect(data).toHaveProperty('name', 'my-feature')
      expect(data).toHaveProperty('branchName')
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

      const mockedOutputSuccess = vi.mocked(outputModule.outputSuccess)
      expect(mockedOutputSuccess).toHaveBeenCalledOnce()
      const data = mockedOutputSuccess.mock.calls[0]![0] as Record<string, unknown>
      expect(data).toHaveProperty('drafts')
      expect(Array.isArray(data.drafts)).toBe(true)
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
      vi.mocked(platformFetch).mockResolvedValue({
        source: 'platform',
        files: [{ path: 'SKILL.md', content: VALID_SKILL_MD }],
      })

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'switch', 'my-feature'])

      expect(updateManifestAndLockfile).toHaveBeenCalled()
    })

    it('outputs a confirmation message with the new ref', async () => {
      setupIdentity()
      setupLockfileOnMain()
      vi.mocked(platformFetch).mockResolvedValue({
        source: 'platform',
        files: [{ path: 'SKILL.md', content: VALID_SKILL_MD }],
      })
      const { stdout } = captureOutput()

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'switch', 'my-feature'])

      expect(stdout.join('')).toContain('draft/test-skill/my-feature')
    })

    it('outputs valid JSON with --json flag', async () => {
      setupIdentity()
      setupLockfileOnMain()
      vi.mocked(platformFetch).mockResolvedValue({
        source: 'platform',
        files: [{ path: 'SKILL.md', content: VALID_SKILL_MD }],
      })

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'draft', 'switch', 'my-feature', '--json'])

      const mockedOutputSuccess = vi.mocked(outputModule.outputSuccess)
      expect(mockedOutputSuccess).toHaveBeenCalledOnce()
      const data = mockedOutputSuccess.mock.calls[0]![0] as Record<string, unknown>
      expect(data.skill).toEqual(expect.stringContaining('test-skill'))
      expect(data).toHaveProperty('draft', 'my-feature')
      expect(data).toHaveProperty('ref', 'draft/test-skill/my-feature')
      expect(data).toHaveProperty('syncedFiles', true)
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
      expect(updateManifestAndLockfile).toHaveBeenCalled()
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

      const mockedOutputSuccess = vi.mocked(outputModule.outputSuccess)
      expect(mockedOutputSuccess).toHaveBeenCalledOnce()
      const data = mockedOutputSuccess.mock.calls[0]![0] as Record<string, unknown>
      expect(data).toHaveProperty('merged', true)
      expect(data).toHaveProperty('commitSha', 'merged123abc')
      expect(data).toHaveProperty('ref', 'main')
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
      expect(updateManifestAndLockfile).toHaveBeenCalled()
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

      const mockedOutputSuccess = vi.mocked(outputModule.outputSuccess)
      expect(mockedOutputSuccess).toHaveBeenCalledOnce()
      const data = mockedOutputSuccess.mock.calls[0]![0] as Record<string, unknown>
      expect(data).toHaveProperty('discarded', true)
      expect(data).toHaveProperty('previousRef', 'draft/test-skill/my-feature')
      expect(data).toHaveProperty('ref', 'main')
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
