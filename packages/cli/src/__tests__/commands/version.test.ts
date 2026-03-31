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
import { registerVersionCommand } from '../../commands/version.js'
import * as outputModule from '../../output.js'
import { platformFetch } from '../../registry/platform.js'
import { readLockfile } from '../../storage/lockfile.js'
import { readManifest } from '../../storage/manifest.js'
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
  registerVersionCommand(program)
  return program
}

const VALID_SKILL_MD = createSkillMd({
  name: 'test-skill',
  description: 'A test skill',
  version: '1.0.0',
})

const GIT_SOURCE = createSharedGitSource({
  uri: 'https://github.com/test-org/test-repo',
  commit: 'abc1234567',
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

/** Sets up a lockfile with a valid commit SHA. */
function setupLockfileWithCommit(commitSha = 'abc1234567'): void {
  vi.mocked(readLockfile).mockReturnValue(
    createLockfile({
      packages: {
        'test-skill': createLockfilePackage({
          source: createSharedGitSource({ commit: commitSha }),
        }),
      },
    })
  )
}

/** Sets up a lockfile with an unknown/missing commit SHA. */
function setupLockfileWithoutCommit(): void {
  vi.mocked(readLockfile).mockReturnValue(
    createLockfile({
      packages: {
        'test-skill': createLockfilePackage({
          source: createSharedGitSource({ commit: 'unknown' }),
        }),
      },
    })
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('version command', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)
    vi.mocked(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // =========================================================================
  // version create
  // =========================================================================

  describe('version create', () => {
    // -----------------------------------------------------------------------
    // 1. Happy path
    // -----------------------------------------------------------------------

    it('creates a version tag with valid semver', async () => {
      setupIdentity()
      setupLockfileWithCommit('abc1234567')
      vi.mocked(platformFetch).mockResolvedValue({
        tag: 'v1.0.0',
        commitSha: 'abc1234567',
      })

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'version', 'create', '1.0.0'])

      expect(platformFetch).toHaveBeenCalledWith(
        expect.stringContaining('/versions'),
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            version: '1.0.0',
            commitSha: 'abc1234567',
          }),
        })
      )
    })

    // -----------------------------------------------------------------------
    // 2. Invalid semver
    // -----------------------------------------------------------------------

    it('rejects invalid semver like "v1.0"', async () => {
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(
        program.parseAsync(['node', 'agentver', 'version', 'create', 'v1.0'])
      ).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('Invalid semver')
      expect(platformFetch).not.toHaveBeenCalled()
    })

    it('rejects "latest" as a version string', async () => {
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(
        program.parseAsync(['node', 'agentver', 'version', 'create', 'latest'])
      ).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('Invalid semver')
      expect(platformFetch).not.toHaveBeenCalled()
    })

    it('rejects versions with a "v" prefix', async () => {
      captureOutput()

      const program = buildProgram()
      await expect(
        program.parseAsync(['node', 'agentver', 'version', 'create', 'v1.0.0'])
      ).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(platformFetch).not.toHaveBeenCalled()
    })

    it('accepts valid semver with pre-release suffix', async () => {
      setupIdentity()
      setupLockfileWithCommit()
      vi.mocked(platformFetch).mockResolvedValue({
        tag: 'v1.0.0-beta.1',
        commitSha: 'abc1234567',
      })

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'version', 'create', '1.0.0-beta.1'])

      expect(platformFetch).toHaveBeenCalledWith(
        expect.stringContaining('/versions'),
        expect.objectContaining({
          body: expect.objectContaining({ version: '1.0.0-beta.1' }),
        })
      )
    })

    // -----------------------------------------------------------------------
    // 3. --notes flag
    // -----------------------------------------------------------------------

    it('sends release notes with the --notes flag', async () => {
      setupIdentity()
      setupLockfileWithCommit()
      vi.mocked(platformFetch).mockResolvedValue({
        tag: 'v1.0.0',
        commitSha: 'abc1234567',
      })

      const program = buildProgram()
      await program.parseAsync([
        'node',
        'agentver',
        'version',
        'create',
        '1.0.0',
        '--notes',
        'Initial stable release',
      ])

      expect(platformFetch).toHaveBeenCalledWith(
        expect.stringContaining('/versions'),
        expect.objectContaining({
          body: expect.objectContaining({
            notes: 'Initial stable release',
          }),
        })
      )
    })

    // -----------------------------------------------------------------------
    // 4. --json output
    // -----------------------------------------------------------------------

    it('outputs valid JSON with --json flag', async () => {
      setupIdentity()
      setupLockfileWithCommit()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(platformFetch).mockResolvedValue({
        tag: 'v1.0.0',
        commitSha: 'abc1234567',
      })

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'version', 'create', '1.0.0', '--json'])

      expect(outputModule.outputSuccess).toHaveBeenCalledWith({
        skill: '@test-org/test-skill',
        version: '1.0.0',
        tag: 'v1.0.0',
        commitSha: 'abc1234567',
      })
    })

    it('uses JSON envelope when JSON mode is enabled without --json flag', async () => {
      setupIdentity()
      setupLockfileWithCommit()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(platformFetch).mockResolvedValue({
        tag: 'v1.0.0',
        commitSha: 'abc1234567',
      })

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'version', 'create', '1.0.0'])

      expect(outputModule.outputSuccess).toHaveBeenCalledWith({
        skill: '@test-org/test-skill',
        version: '1.0.0',
        tag: 'v1.0.0',
        commitSha: 'abc1234567',
      })
    })

    // -----------------------------------------------------------------------
    // 5. Not authenticated
    // -----------------------------------------------------------------------

    it('surfaces authentication error when not logged in', async () => {
      setupIdentity()
      setupLockfileWithCommit()
      vi.mocked(platformFetch).mockRejectedValue(
        new Error('Not authenticated. Run `agentver login` to sign in.')
      )

      const program = buildProgram()
      await expect(
        program.parseAsync(['node', 'agentver', 'version', 'create', '1.0.0'])
      ).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    // -----------------------------------------------------------------------
    // 6. No commit SHA in lockfile
    // -----------------------------------------------------------------------

    it('exits with error when lockfile has no valid commit SHA', async () => {
      setupIdentity()
      setupLockfileWithoutCommit()
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(
        program.parseAsync(['node', 'agentver', 'version', 'create', '1.0.0'])
      ).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('No commit SHA found')
      expect(platformFetch).not.toHaveBeenCalled()
    })

    it('exits with error when skill is not in the lockfile at all', async () => {
      setupIdentity()
      vi.mocked(readLockfile).mockReturnValue(createLockfile({ packages: {} }))
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(
        program.parseAsync(['node', 'agentver', 'version', 'create', '1.0.0'])
      ).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('No commit SHA found')
      expect(platformFetch).not.toHaveBeenCalled()
    })

    // -----------------------------------------------------------------------
    // Additional: skill identity cannot be determined
    // -----------------------------------------------------------------------

    it('exits with error when skill identity cannot be determined', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      vi.mocked(readManifest).mockReturnValue(createManifest({ packages: {} }))
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(
        program.parseAsync(['node', 'agentver', 'version', 'create', '1.0.0'])
      ).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('Could not determine skill identity')
      expect(platformFetch).not.toHaveBeenCalled()
    })

    // -----------------------------------------------------------------------
    // Additional: API error
    // -----------------------------------------------------------------------

    it('surfaces API errors from the platform', async () => {
      setupIdentity()
      setupLockfileWithCommit()
      vi.mocked(platformFetch).mockRejectedValue(
        new Error('Platform error (409): Version 1.0.0 already exists')
      )

      const program = buildProgram()
      await expect(
        program.parseAsync(['node', 'agentver', 'version', 'create', '1.0.0'])
      ).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    // -----------------------------------------------------------------------
    // Additional: no platform connection
    // -----------------------------------------------------------------------

    it('surfaces connection error when no platform URL is configured', async () => {
      setupIdentity()
      setupLockfileWithCommit()
      vi.mocked(platformFetch).mockRejectedValue(
        new Error('No platform URL configured. Run `agentver login <url>` to connect.')
      )

      const program = buildProgram()
      await expect(
        program.parseAsync(['node', 'agentver', 'version', 'create', '1.0.0'])
      ).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
    })
  })

  // =========================================================================
  // version list
  // =========================================================================

  describe('version list', () => {
    // -----------------------------------------------------------------------
    // 1. Happy path
    // -----------------------------------------------------------------------

    it('fetches and displays version history', async () => {
      setupIdentity()
      const { stdout } = captureOutput()
      vi.mocked(platformFetch).mockResolvedValue([
        {
          name: 'v1.0.0',
          tag: 'v1.0.0',
          commitSha: 'abc1234567',
          message: 'Initial release',
        },
        {
          name: 'v0.9.0',
          tag: 'v0.9.0',
          commitSha: 'def7890123',
          message: 'Beta release',
        },
      ])

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'version', 'list'])

      expect(platformFetch).toHaveBeenCalledWith(expect.stringContaining('/versions'))
      expect(stdout.join('')).toContain('v1.0.0')
      expect(stdout.join('')).toContain('v0.9.0')
    })

    it('supports the top-level versions command alias', async () => {
      setupIdentity()
      vi.mocked(platformFetch).mockResolvedValue([
        {
          name: 'v1.0.0',
          tag: 'v1.0.0',
          commitSha: 'abc1234567',
          message: 'Initial release',
        },
      ])

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'versions'])

      expect(platformFetch).toHaveBeenCalledWith(expect.stringContaining('/versions'))
    })

    // -----------------------------------------------------------------------
    // 2. No versions yet
    // -----------------------------------------------------------------------

    it('displays a message when there are no versions', async () => {
      setupIdentity()
      const { stdout } = captureOutput()
      vi.mocked(platformFetch).mockResolvedValue([])

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'version', 'list'])

      expect(stdout.join('')).toContain('No versions found')
    })

    // -----------------------------------------------------------------------
    // 3. --json output
    // -----------------------------------------------------------------------

    it('outputs valid JSON with --json flag', async () => {
      setupIdentity()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(platformFetch).mockResolvedValue([
        {
          name: 'v1.0.0',
          tag: 'v1.0.0',
          commitSha: 'abc1234567',
          message: 'Initial release',
        },
      ])

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'version', 'list', '--json'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [output] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = output as Record<string, unknown>
      expect(typed).toHaveProperty('versions')
      expect(Array.isArray(typed.versions)).toBe(true)
      const versions = typed.versions as Array<Record<string, unknown>>
      expect(versions[0]).toHaveProperty('name', 'v1.0.0')
      expect(versions[0]).toHaveProperty('commitSha', 'abc1234567')
    })

    it('outputs valid JSON with empty version list', async () => {
      setupIdentity()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(platformFetch).mockResolvedValue([])

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'version', 'list', '--json'])

      expect(outputModule.outputSuccess).toHaveBeenCalledWith({ versions: [] })
    })

    it('uses JSON envelope for list when JSON mode is enabled without --json flag', async () => {
      setupIdentity()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(platformFetch).mockResolvedValue([
        {
          name: 'v1.0.0',
          tag: 'v1.0.0',
          commitSha: 'abc1234567',
          message: 'Initial release',
        },
      ])

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'version', 'list'])

      expect(outputModule.outputSuccess).toHaveBeenCalledWith({
        versions: [
          {
            name: 'v1.0.0',
            tag: 'v1.0.0',
            commitSha: 'abc1234567',
            message: 'Initial release',
          },
        ],
      })
    })

    // -----------------------------------------------------------------------
    // 4. Formats commit SHAs (truncated in non-JSON output)
    // -----------------------------------------------------------------------

    it('truncates commit SHAs to 7 characters in human-readable output', async () => {
      setupIdentity()
      const { stdout } = captureOutput()
      vi.mocked(platformFetch).mockResolvedValue([
        {
          name: 'v1.0.0',
          tag: 'v1.0.0',
          commitSha: 'abc1234567890abcdef',
          message: 'Initial release',
        },
      ])

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'version', 'list'])

      // The code calls commitSha.slice(0, 7) -> 'abc1234'
      expect(stdout.join('')).toContain('abc1234')
    })

    // -----------------------------------------------------------------------
    // 5. Not authenticated
    // -----------------------------------------------------------------------

    it('surfaces authentication error when not logged in', async () => {
      setupIdentity()
      vi.mocked(platformFetch).mockRejectedValue(
        new Error('Not authenticated. Run `agentver login` to sign in.')
      )

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'version', 'list'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    // -----------------------------------------------------------------------
    // Additional: skill identity cannot be determined
    // -----------------------------------------------------------------------

    it('exits with error when skill identity cannot be determined', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      vi.mocked(readManifest).mockReturnValue(createManifest({ packages: {} }))
      const { stderr } = captureOutput()

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'version', 'list'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
      expect(stderr.join('')).toContain('Could not determine skill identity')
    })

    // -----------------------------------------------------------------------
    // Additional: connection error
    // -----------------------------------------------------------------------

    it('surfaces connection error when no platform URL is configured', async () => {
      setupIdentity()
      vi.mocked(platformFetch).mockRejectedValue(
        new Error('No platform URL configured. Run `agentver login <url>` to connect.')
      )

      const program = buildProgram()
      await expect(program.parseAsync(['node', 'agentver', 'version', 'list'])).rejects.toThrow()

      expect(processExitSpy).toHaveBeenCalledWith(1)
    })
  })
})
