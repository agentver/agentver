import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('../../git/fetcher.js', () => ({
  readFilesFromDirectory: vi.fn(),
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
import { registerSaveCommand } from '../../commands/save.js'
import { readFilesFromDirectory } from '../../git/fetcher.js'
import { platformFetch } from '../../registry/platform.js'
import { readLockfile, writeLockfile } from '../../storage/lockfile.js'
import { readManifest } from '../../storage/manifest.js'
import {
  createFetchedFiles,
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
  registerSaveCommand(program)
  return program
}

const VALID_SKILL_MD = createSkillMd({
  name: 'test-skill',
  description: 'A test skill',
  version: '1.0.0',
})

const FETCHED_FILES = createFetchedFiles(2)

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

const GIT_SOURCE = createSharedGitSource({
  uri: 'https://github.com/test-org/test-repo',
})

function setupHappyPath(): void {
  vi.mocked(existsSync).mockReturnValue(true)
  vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
  vi.mocked(readManifest).mockReturnValue(
    createManifest({
      packages: {
        'test-skill': createManifestPackage({ source: GIT_SOURCE }),
      },
    })
  )
  vi.mocked(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
  vi.mocked(readLockfile).mockReturnValue(
    createLockfile({
      packages: {
        'test-skill': createLockfilePackage({ source: GIT_SOURCE }),
      },
    })
  )
  vi.mocked(writeLockfile).mockReturnValue(undefined)
  vi.mocked(platformFetch).mockResolvedValue({ commitSha: 'def7890abcdef' })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('save command', () => {
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

  // -------------------------------------------------------------------------
  // 1. Happy path
  // -------------------------------------------------------------------------

  it('saves local files to the platform and updates the lockfile', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'save'])

    expect(readFilesFromDirectory).toHaveBeenCalled()
    expect(platformFetch).toHaveBeenCalledWith(
      expect.stringContaining('/save'),
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          message: expect.stringContaining('test-skill'),
          files: expect.arrayContaining([expect.objectContaining({ path: 'SKILL.md' })]),
        }),
      })
    )
    expect(writeLockfile).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 2. With message
  // -------------------------------------------------------------------------

  it('sends the provided commit message in the API request', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'save', 'fixed prompt wording'])

    expect(platformFetch).toHaveBeenCalledWith(
      expect.stringContaining('/save'),
      expect.objectContaining({
        body: expect.objectContaining({
          message: 'fixed prompt wording',
        }),
      })
    )
  })

  it('uses a default message when none is provided', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'save'])

    expect(platformFetch).toHaveBeenCalledWith(
      expect.stringContaining('/save'),
      expect.objectContaining({
        body: expect.objectContaining({
          message: 'Update skill: test-skill',
        }),
      })
    )
  })

  // -------------------------------------------------------------------------
  // 3. --dry-run
  // -------------------------------------------------------------------------

  it('shows what would be saved without calling the API in dry-run mode', async () => {
    setupHappyPath()
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'save', '--dry-run'])

    expect(platformFetch).not.toHaveBeenCalled()
    expect(writeLockfile).not.toHaveBeenCalled()
    expect(stdout.join('')).toContain('dry-run')
  })

  // -------------------------------------------------------------------------
  // 4. --json output
  // -------------------------------------------------------------------------

  it('outputs valid JSON with --json flag on success', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'save', '--json'])

    expect(consoleLogSpy).toHaveBeenCalled()
    const output = JSON.parse(consoleLogSpy.mock.calls[0]![0] as string) as Record<string, unknown>
    expect(output.skill).toEqual(expect.stringContaining('test-skill'))
    expect(output).toHaveProperty('commitSha', 'def7890abcdef')
    expect(output).toHaveProperty('files')
    expect(Array.isArray(output.files)).toBe(true)
  })

  it('outputs valid JSON with --json and --dry-run', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'save', '--dry-run', '--json'])

    expect(platformFetch).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalled()
    const output = JSON.parse(consoleLogSpy.mock.calls[0]![0] as string) as Record<string, unknown>
    expect(output).toHaveProperty('dryRun', true)
    expect(output.skill).toEqual(expect.stringContaining('test-skill'))
    expect(output).toHaveProperty('message')
    expect(output).toHaveProperty('files')
  })

  // -------------------------------------------------------------------------
  // 5. No changes / empty directory
  // -------------------------------------------------------------------------

  it('exits with error when no files are found in the skill directory', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
    vi.mocked(readManifest).mockReturnValue(
      createManifest({
        packages: {
          'test-skill': createManifestPackage({ source: GIT_SOURCE }),
        },
      })
    )
    vi.mocked(readFilesFromDirectory).mockResolvedValue([])

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'save'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(platformFetch).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 6. Not authenticated
  // -------------------------------------------------------------------------

  it('surfaces authentication error when not logged in', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
    vi.mocked(readManifest).mockReturnValue(
      createManifest({
        packages: {
          'test-skill': createManifestPackage({ source: GIT_SOURCE }),
        },
      })
    )
    vi.mocked(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    vi.mocked(platformFetch).mockRejectedValue(
      new Error('Not authenticated. Run `agentver login` to sign in.')
    )

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'save'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  // -------------------------------------------------------------------------
  // 7. No platform connection
  // -------------------------------------------------------------------------

  it('surfaces connection error when no platform URL is configured', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
    vi.mocked(readManifest).mockReturnValue(
      createManifest({
        packages: {
          'test-skill': createManifestPackage({ source: GIT_SOURCE }),
        },
      })
    )
    vi.mocked(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    vi.mocked(platformFetch).mockRejectedValue(
      new Error('No platform URL configured. Run `agentver login <url>` to connect.')
    )

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'save'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  // -------------------------------------------------------------------------
  // 8. Lockfile update after save
  // -------------------------------------------------------------------------

  it('updates the lockfile entry with the new commit SHA from the API response', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'save'])

    expect(writeLockfile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        packages: expect.objectContaining({
          'test-skill': expect.objectContaining({
            source: expect.objectContaining({
              commit: 'def7890abcdef',
            }),
          }),
        }),
      })
    )
  })

  // -------------------------------------------------------------------------
  // 9. --path flag
  // -------------------------------------------------------------------------

  it('saves skill from the specified --path directory', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'save', '--path', './my-skill'])

    expect(readFilesFromDirectory).toHaveBeenCalled()
    expect(platformFetch).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Additional: missing SKILL.md
  // -------------------------------------------------------------------------

  it('exits with error when SKILL.md is not found', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const { stderr } = captureOutput()

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'save'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(stderr.join('')).toContain('No SKILL.md found')
    expect(platformFetch).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // agentver:// URI support
  // -------------------------------------------------------------------------

  it('correctly extracts org from agentver:// URI and calls the right endpoint', async () => {
    const agentverSource = createSharedGitSource({
      uri: 'agentver://myorg',
    })

    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
    vi.mocked(readManifest).mockReturnValue(
      createManifest({
        packages: {
          'test-skill': createManifestPackage({ source: agentverSource }),
        },
      })
    )
    vi.mocked(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    vi.mocked(readLockfile).mockReturnValue(
      createLockfile({
        packages: {
          'test-skill': createLockfilePackage({ source: agentverSource }),
        },
      })
    )
    vi.mocked(writeLockfile).mockReturnValue(undefined)
    vi.mocked(platformFetch).mockResolvedValue({ commitSha: 'abc1234567' })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'save'])

    expect(platformFetch).toHaveBeenCalledWith(
      '/skills/@myorg/test-skill/save',
      expect.objectContaining({ method: 'POST' })
    )
  })

  // -------------------------------------------------------------------------
  // Additional: skill not in manifest
  // -------------------------------------------------------------------------

  it('exits with error when skill is not found in the manifest', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
    vi.mocked(readManifest).mockReturnValue(createManifest({ packages: {} }))
    const { stderr } = captureOutput()

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'save'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(stderr.join('')).toContain('not found in manifest')
    expect(platformFetch).not.toHaveBeenCalled()
  })
})
