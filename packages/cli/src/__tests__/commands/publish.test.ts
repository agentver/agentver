import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that reference them
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
import { registerPublishCommand } from '../../commands/publish.js'
import { readFilesFromDirectory } from '../../git/fetcher.js'
import * as outputModule from '../../output.js'
import { platformFetch } from '../../registry/platform.js'
import { scanFiles } from '../../security/index.js'
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
  createSkillMd,
} from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerPublishCommand(program)
  return program
}

const VALID_SKILL_MD = createSkillMd({
  name: 'test-skill',
  description: 'A test skill',
  version: '1.0.0',
})

const FETCHED_FILES = createFetchedFiles(3)

/** Capture all writes to stdout/stderr for assertion. */
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

/** Default mock setup for a successful publish. */
function setupHappyPath(): void {
  asMock(existsSync).mockReturnValue(true)
  asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
  asMock(readManifest).mockReturnValue({ version: 2, packages: {} })
  asMock(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
  asMock(scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
  asMock(platformFetch).mockResolvedValue({
    version: '1.0.0',
    commitSha: 'abc1234567890',
  })
  asMock(updateManifestAndLockfile).mockImplementation((_projectRoot, _scope, updater) =>
    updater({ version: 2, packages: {} }, { version: 2, packages: {} })
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('publish command', () => {
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

  it('publishes a valid skill directory successfully', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'publish'])

    expect(readFilesFromDirectory).toHaveBeenCalled()
    expect(platformFetch).toHaveBeenCalledWith(
      expect.stringContaining('/publish'),
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          version: '1.0.0',
          files: expect.arrayContaining([expect.objectContaining({ path: 'SKILL.md' })]),
        }),
      })
    )
  })

  it('preserves typed platform provenance when publishing an installed platform skill', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
    asMock(readManifest).mockReturnValue(
      createManifest({
        packages: {
          'platform:agentver-skill': Object.assign(
            createManifestPackage({
              source: createPlatformSource({
                uri: 'agentver://test-org',
                path: 'skills/test-skill',
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
    asMock(scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
    asMock(platformFetch).mockResolvedValue({
      version: '1.0.0',
      commitSha: 'fedcba9876543',
    })

    let updatedManifest: ReturnType<typeof createManifest> | undefined
    let updatedLockfile: ReturnType<typeof createLockfile> | undefined

    asMock(updateManifestAndLockfile).mockImplementation((_projectRoot, _scope, updater) => {
      const manifest = createManifest({
        packages: {
          'platform:agentver-skill': Object.assign(
            createManifestPackage({
              source: createPlatformSource({
                uri: 'agentver://test-org',
                path: 'skills/test-skill',
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
                path: 'skills/test-skill',
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
    await program.parseAsync(['node', 'agentver', 'publish'])

    expect(updatedManifest?.packages['platform:agentver-skill']?.source).toMatchObject({
      type: 'platform',
      uri: 'agentver://test-org',
      path: 'skills/test-skill',
      ref: 'main',
      commit: 'fedcba9876543',
    })
    expect(updatedLockfile?.packages['platform:agentver-skill']?.source).toMatchObject({
      type: 'platform',
      uri: 'agentver://test-org',
      path: 'skills/test-skill',
      ref: 'main',
      commit: 'fedcba9876543',
    })
  })

  // -------------------------------------------------------------------------
  // 2. --version flag overrides SKILL.md version
  // -------------------------------------------------------------------------

  it('uses --version flag to override frontmatter version', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'publish', '--version', '2.0.0'])

    expect(platformFetch).toHaveBeenCalledWith(
      expect.stringContaining('/publish'),
      expect.objectContaining({
        body: expect.objectContaining({ version: '2.0.0' }),
      })
    )
  })

  // -------------------------------------------------------------------------
  // 3. --dry-run shows files but does not call API
  // -------------------------------------------------------------------------

  it('shows files that would be published without calling API in dry-run mode', async () => {
    setupHappyPath()
    const { stdout } = captureOutput()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'publish', '--dry-run'])

    expect(platformFetch).not.toHaveBeenCalled()
    expect(stdout.join('')).toContain('dry-run')
  })

  // -------------------------------------------------------------------------
  // 4. --json output produces valid JSON
  // -------------------------------------------------------------------------

  it('outputs valid JSON with --json flag on success', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'publish', '--json'])

    const mockedOutputSuccess = asMock(outputModule.outputSuccess)
    expect(mockedOutputSuccess).toHaveBeenCalledOnce()
    const data = mockedOutputSuccess.mock.calls[0]![0] as Record<string, unknown>
    expect(data.skill).toEqual(expect.stringContaining('test-skill'))
    expect(data).toHaveProperty('version', '1.0.0')
    expect(data).toHaveProperty('commitSha', 'abc1234567890')
  })

  it('outputs valid JSON with --json and --dry-run', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'publish', '--dry-run', '--json'])

    expect(platformFetch).not.toHaveBeenCalled()
    const mockedOutputSuccess = asMock(outputModule.outputSuccess)
    expect(mockedOutputSuccess).toHaveBeenCalledOnce()
    const data = mockedOutputSuccess.mock.calls[0]![0] as Record<string, unknown>
    expect(data).toHaveProperty('dryRun', true)
    expect(data).toHaveProperty('version', '1.0.0')
    expect(data).toHaveProperty('files')
    expect(Array.isArray(data.files)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // 5. Missing SKILL.md
  // -------------------------------------------------------------------------

  it('exits with error when SKILL.md is missing', async () => {
    asMock(existsSync).mockReturnValue(false)
    const { stderr } = captureOutput()

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'publish'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(stderr.join('')).toContain('No SKILL.md found')
    expect(platformFetch).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 6. Invalid frontmatter
  // -------------------------------------------------------------------------

  it('exits with error when SKILL.md has invalid frontmatter', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(
      '---\nname: test\n---\n# Just name, no version or description'
    )

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'publish'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('exits with error when SKILL.md has no frontmatter at all', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue('# Just a markdown file\n\nNo frontmatter here.')

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'publish'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(platformFetch).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 7. Security audit BLOCK
  // -------------------------------------------------------------------------

  it('refuses to publish when security audit returns BLOCK', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
    asMock(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
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
    const { stderr } = captureOutput()

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'publish'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(stderr.join('')).toContain('BLOCK')
    expect(platformFetch).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 8. --skip-audit bypasses the security scanner
  // -------------------------------------------------------------------------

  it('does not call the security scanner when --skip-audit is set', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'publish', '--skip-audit'])

    expect(scanFiles).not.toHaveBeenCalled()
    expect(platformFetch).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 9. Not authenticated — platformFetch throws UNAUTHORISED
  // -------------------------------------------------------------------------

  it('surfaces authentication error when not logged in', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
    asMock(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    asMock(scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
    asMock(platformFetch).mockRejectedValue(
      new Error('Not authenticated. Run `agentver login` to sign in.')
    )

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'publish'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  // -------------------------------------------------------------------------
  // 10. No platform connection — platformFetch throws UNAUTHORISED
  // -------------------------------------------------------------------------

  it('surfaces connection error when no platform URL is configured', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
    asMock(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    asMock(scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
    asMock(platformFetch).mockRejectedValue(
      new Error('No platform URL configured. Run `agentver login <url>` to connect.')
    )

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'publish'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  // -------------------------------------------------------------------------
  // 11. API error — platform returns 400
  // -------------------------------------------------------------------------

  it('surfaces API error message when platform returns a non-OK response', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
    asMock(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    asMock(scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
    asMock(platformFetch).mockRejectedValue(
      new Error('Platform error (400): Version already exists')
    )

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'publish'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  // -------------------------------------------------------------------------
  // 12. Semver validation
  // -------------------------------------------------------------------------

  it('rejects --version with invalid semver', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
    asMock(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)

    const program = buildProgram()
    await expect(
      program.parseAsync(['node', 'agentver', 'publish', '--version', 'not-a-semver'])
    ).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('rejects versions missing the patch segment', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
    asMock(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)

    const program = buildProgram()
    await expect(
      program.parseAsync(['node', 'agentver', 'publish', '--version', '1.0'])
    ).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('accepts valid semver with pre-release suffix', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'publish', '--version', '1.0.0-beta.1'])

    expect(platformFetch).toHaveBeenCalledWith(
      expect.stringContaining('/publish'),
      expect.objectContaining({
        body: expect.objectContaining({ version: '1.0.0-beta.1' }),
      })
    )
  })

  // -------------------------------------------------------------------------
  // Additional: WARN verdict continues publishing
  // -------------------------------------------------------------------------

  it('continues publishing when security audit returns WARN', async () => {
    asMock(existsSync).mockReturnValue(true)
    asMock(readFileSync).mockReturnValue(VALID_SKILL_MD)
    asMock(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    asMock(scanFiles).mockResolvedValue(createAuditScanResult('WARN'))
    asMock(platformFetch).mockResolvedValue({
      version: '1.0.0',
      commitSha: 'abc1234567890',
    })

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'publish'])

    expect(platformFetch).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // --public flag
  // -------------------------------------------------------------------------

  it('sends visibility PUBLIC in request body when --public flag is set', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'publish', '--public'])

    expect(platformFetch).toHaveBeenCalledWith(
      expect.stringContaining('/publish'),
      expect.objectContaining({
        body: expect.objectContaining({ visibility: 'PUBLIC' }),
      })
    )
  })

  it('does not include visibility in request body when --public flag is omitted', async () => {
    setupHappyPath()

    const program = buildProgram()
    await program.parseAsync(['node', 'agentver', 'publish'])

    const call = asMock(platformFetch).mock.calls[0]
    const body = (call?.[1] as { body: Record<string, unknown> } | undefined)?.body
    expect(body).not.toHaveProperty('visibility')
  })
})
