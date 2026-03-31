import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

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

vi.mock('../../security/index.js', () => ({
  scanFiles: vi.fn(),
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
import { registerSaveCommand } from '../../commands/save.js'
import { readFilesFromDirectory } from '../../git/fetcher.js'
import * as outputModule from '../../output.js'
import { platformFetch } from '../../registry/platform.js'
import { scanFiles } from '../../security/index.js'
import { readLockfile } from '../../storage/lockfile.js'
import { readManifest } from '../../storage/manifest.js'
import { updateManifestAndLockfile } from '../../storage/pair.js'
import {
  createAuditScanResult,
  createFetchedFiles,
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createPlatformSource,
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

function asMock(value: unknown): Mock {
  return value as Mock
}

const GIT_SOURCE = createSharedGitSource({
  uri: 'https://github.com/test-org/test-repo',
})

function setupHappyPath(): void {
  asMock(existsSync).mockReturnValue(true)
  asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
  asMock(readManifest).mockReturnValue(
    createManifest({
      packages: {
        'test-skill': createManifestPackage({ source: GIT_SOURCE }),
      },
    })
  )
  asMock(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
  asMock(readLockfile).mockReturnValue(
    createLockfile({
      packages: {
        'test-skill': createLockfilePackage({ source: GIT_SOURCE }),
      },
    })
  )
  asMock(platformFetch).mockResolvedValue({ commitSha: 'def7890abcdef' })
  asMock(scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
  asMock(updateManifestAndLockfile).mockImplementation((_projectRoot, _scope, updater) => {
    const manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage({ source: GIT_SOURCE }),
      },
    })
    const lockfile = createLockfile({
      packages: {
        'test-skill': createLockfilePackage({ source: GIT_SOURCE }),
      },
    })

    return updater(manifest, lockfile)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('save command', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)
    asMock(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
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
    expect(updateManifestAndLockfile).toHaveBeenCalled()
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

  it('uses typed platform provenance for ref tracking and lockfile updates', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
    asMock(readManifest).mockReturnValue(
      createManifest({
        packages: {
          'platform:agentver-skill': Object.assign(
            createManifestPackage({
              source: createPlatformSource({
                uri: 'agentver://test-org',
                ref: 'draft',
                commit: 'abc1234567',
              }),
            }),
            { name: 'test-skill' }
          ),
        },
      })
    )
    asMock(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    asMock(readLockfile).mockReturnValue(
      createLockfile({
        packages: {
          'platform:agentver-skill': Object.assign(
            createLockfilePackage({
              source: createPlatformSource({
                uri: 'agentver://test-org',
                ref: 'draft',
                commit: 'abc1234567',
              }),
            }),
            { name: 'test-skill' }
          ),
        },
      })
    )
    asMock(platformFetch).mockResolvedValue({ commitSha: 'def7890abcdef' })
    asMock(scanFiles).mockResolvedValue(createAuditScanResult('PASS'))

    let updatedManifest: ReturnType<typeof createManifest> | undefined
    let updatedLockfile: ReturnType<typeof createLockfile> | undefined

    asMock(updateManifestAndLockfile).mockImplementation((_projectRoot, _scope, updater) => {
      const manifest = createManifest({
        packages: {
          'platform:agentver-skill': Object.assign(
            createManifestPackage({
              source: createPlatformSource({
                uri: 'agentver://test-org',
                ref: 'draft',
                commit: 'abc1234567',
              }),
            }),
            { name: 'test-skill' }
          ),
        },
      })
      const lockfile = createLockfile({
        packages: {
          'platform:agentver-skill': Object.assign(
            createLockfilePackage({
              source: createPlatformSource({
                uri: 'agentver://test-org',
                ref: 'draft',
                commit: 'abc1234567',
              }),
            }),
            { name: 'test-skill' }
          ),
        },
      })

      const updated = updater(manifest, lockfile)
      updatedManifest = updated.manifest
      updatedLockfile = updated.lockfile
      return updated
    })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'save'])

    expect(platformFetch).toHaveBeenCalledWith(
      expect.stringContaining('/save'),
      expect.objectContaining({
        body: expect.objectContaining({
          ref: 'draft',
        }),
      })
    )
    expect(updatedManifest?.packages['platform:agentver-skill']?.source).toMatchObject({
      type: 'platform',
      ref: 'draft',
      commit: 'def7890abcdef',
    })
    expect(updatedLockfile?.packages['platform:agentver-skill']?.source).toMatchObject({
      type: 'platform',
      ref: 'draft',
      commit: 'def7890abcdef',
    })
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
    expect(updateManifestAndLockfile).not.toHaveBeenCalled()
    expect(stdout.join('')).toContain('dry-run')
  })

  it('blocks save when the security audit returns BLOCK', async () => {
    setupHappyPath()
    asMock(scanFiles).mockResolvedValue(
      createAuditScanResult('BLOCK', {
        findings: [
          {
            severity: 'HIGH',
            category: 'DANGEROUS_COMMAND',
            file: 'SKILL.md',
            line: 5,
            message: 'Dangerous command detected',
          },
        ],
      })
    )

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'save'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('skips the security audit when --skip-audit is set', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'save', '--skip-audit'])

    expect(scanFiles).not.toHaveBeenCalled()
    expect(platformFetch).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 4. --json output
  // -------------------------------------------------------------------------

  it('outputs valid JSON with --json flag on success', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'save', '--json'])

    const mockedOutputSuccess = asMock(outputModule.outputSuccess)
    expect(mockedOutputSuccess).toHaveBeenCalledOnce()
    const data = mockedOutputSuccess.mock.calls[0]![0] as Record<string, unknown>
    expect(data.skill).toEqual(expect.stringContaining('test-skill'))
    expect(data).toHaveProperty('commitSha', 'def7890abcdef')
    expect(data).toHaveProperty('files')
    expect(Array.isArray(data.files)).toBe(true)
  })

  it('outputs valid JSON with --json and --dry-run', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'save', '--dry-run', '--json'])

    expect(platformFetch).not.toHaveBeenCalled()
    const mockedOutputSuccess = asMock(outputModule.outputSuccess)
    expect(mockedOutputSuccess).toHaveBeenCalledOnce()
    const data = mockedOutputSuccess.mock.calls[0]![0] as Record<string, unknown>
    expect(data).toHaveProperty('dryRun', true)
    expect(data.skill).toEqual(expect.stringContaining('test-skill'))
    expect(data).toHaveProperty('message')
    expect(data).toHaveProperty('files')
  })

  // -------------------------------------------------------------------------
  // 5. No changes / empty directory
  // -------------------------------------------------------------------------

  it('exits with error when no files are found in the skill directory', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
    asMock(readManifest).mockReturnValue(
      createManifest({
        packages: {
          'test-skill': createManifestPackage({ source: GIT_SOURCE }),
        },
      })
    )
    asMock(readFilesFromDirectory).mockResolvedValue([])

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'save'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(platformFetch).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 6. Not authenticated
  // -------------------------------------------------------------------------

  it('surfaces authentication error when not logged in', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
    asMock(readManifest).mockReturnValue(
      createManifest({
        packages: {
          'test-skill': createManifestPackage({ source: GIT_SOURCE }),
        },
      })
    )
    asMock(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    asMock(platformFetch).mockRejectedValue(
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
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
    asMock(readManifest).mockReturnValue(
      createManifest({
        packages: {
          'test-skill': createManifestPackage({ source: GIT_SOURCE }),
        },
      })
    )
    asMock(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    asMock(platformFetch).mockRejectedValue(
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

    expect(updateManifestAndLockfile).toHaveBeenCalled()
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
    asMock(existsSync).mockReturnValue(false)
    const { stderr } = captureOutput()

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'save'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(stderr.join('')).toContain('No SKILL.md found')
    expect(platformFetch).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Additional: skill not in manifest
  // -------------------------------------------------------------------------

  it('exits with error when skill is not found in the manifest', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
    asMock(readManifest).mockReturnValue(createManifest({ packages: {} }))
    const { stderr } = captureOutput()

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'save'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(stderr.join('')).toContain('not found in manifest')
    expect(platformFetch).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // agentver:// URI org extraction
  // -------------------------------------------------------------------------

  describe('agentver:// URI org extraction', () => {
    function setupWithUri(uri: string): void {
      const source = createSharedGitSource({ uri })
      asMock(existsSync).mockReturnValue(true)
      asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
      asMock(readManifest).mockReturnValue(
        createManifest({
          packages: {
            'test-skill': createManifestPackage({ source }),
          },
        })
      )
      asMock(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
      asMock(readLockfile).mockReturnValue(
        createLockfile({
          packages: {
            'test-skill': createLockfilePackage({ source }),
          },
        })
      )
      asMock(platformFetch).mockResolvedValue({ commitSha: 'abc1234567' })
      asMock(updateManifestAndLockfile).mockImplementation((_projectRoot, _scope, updater) => {
        const manifest = createManifest({
          packages: {
            'test-skill': createManifestPackage({ source }),
          },
        })
        const lockfile = createLockfile({
          packages: {
            'test-skill': createLockfilePackage({ source }),
          },
        })

        return updater(manifest, lockfile)
      })
    }

    it('extracts org from agentver://orgSlug URI', async () => {
      setupWithUri('agentver://lleverage')

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'save'])

      expect(platformFetch).toHaveBeenCalledWith(
        '/skills/@lleverage/test-skill/save',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('extracts org from agentver://orgSlug with trailing path segments', async () => {
      setupWithUri('agentver://my-org/skills/some-skill')

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'save'])

      expect(platformFetch).toHaveBeenCalledWith(
        '/skills/@my-org/test-skill/save',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('extracts org from agentver://orgSlug with ref', async () => {
      setupWithUri('agentver://acme-corp@main')

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'save'])

      expect(platformFetch).toHaveBeenCalledWith(
        '/skills/@acme-corp/test-skill/save',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('extracts org from external https git URI', async () => {
      setupWithUri('https://github.com/test-org/test-repo')

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'save'])

      expect(platformFetch).toHaveBeenCalledWith(
        '/skills/@test-org/test-skill/save',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('extracts org from external git URI without protocol', async () => {
      setupWithUri('github.com/some-org/some-repo')

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'save'])

      expect(platformFetch).toHaveBeenCalledWith(
        '/skills/@some-org/test-skill/save',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('includes correct org in dry-run JSON output for agentver:// URI', async () => {
      setupWithUri('agentver://lleverage')

      const program = buildProgram()
      await program.parseAsync(['node', 'agentver', 'save', '--dry-run', '--json'])

      expect(platformFetch).not.toHaveBeenCalled()
      const mockedOutputSuccess = asMock(outputModule.outputSuccess)
      expect(mockedOutputSuccess).toHaveBeenCalledOnce()
      const data = mockedOutputSuccess.mock.calls[0]![0] as Record<string, unknown>
      expect(data.skill).toBe('@lleverage/test-skill')
    })
  })
})
