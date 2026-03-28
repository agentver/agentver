import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    text: '',
  })),
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
import { createAuditScanResult, createFetchedFiles, createSkillMd } from '../helpers/fixtures'

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

/** Default mock setup for a successful publish. */
function setupHappyPath(): void {
  vi.mocked(existsSync).mockReturnValue(true)
  vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
  vi.mocked(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
  vi.mocked(scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
  vi.mocked(platformFetch).mockResolvedValue({
    version: '1.0.0',
    commitSha: 'abc1234567890',
  })
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

    const mockedOutputSuccess = vi.mocked(outputModule.outputSuccess)
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
    const mockedOutputSuccess = vi.mocked(outputModule.outputSuccess)
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
    vi.mocked(existsSync).mockReturnValue(false)
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
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(
      '---\nname: test\n---\n# Just name, no version or description'
    )

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'publish'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('exits with error when SKILL.md has no frontmatter at all', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('# Just a markdown file\n\nNo frontmatter here.')

    const program = buildProgram()
    await expect(program.parseAsync(['node', 'agentver', 'publish'])).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(platformFetch).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 7. Security audit BLOCK
  // -------------------------------------------------------------------------

  it('refuses to publish when security audit returns BLOCK', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
    vi.mocked(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    vi.mocked(scanFiles).mockResolvedValue(
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
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
    vi.mocked(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    vi.mocked(scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
    vi.mocked(platformFetch).mockRejectedValue(
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
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
    vi.mocked(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    vi.mocked(scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
    vi.mocked(platformFetch).mockRejectedValue(
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
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
    vi.mocked(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    vi.mocked(scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
    vi.mocked(platformFetch).mockRejectedValue(
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
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
    vi.mocked(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)

    const program = buildProgram()
    await expect(
      program.parseAsync(['node', 'agentver', 'publish', '--version', 'not-a-semver'])
    ).rejects.toThrow()

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('rejects versions missing the patch segment', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
    vi.mocked(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)

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
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(VALID_SKILL_MD)
    vi.mocked(readFilesFromDirectory).mockResolvedValue(FETCHED_FILES)
    vi.mocked(scanFiles).mockResolvedValue(createAuditScanResult('WARN'))
    vi.mocked(platformFetch).mockResolvedValue({
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

    const call = vi.mocked(platformFetch).mock.calls[0]
    const body = (call?.[1] as { body: Record<string, unknown> } | undefined)?.body
    expect(body).not.toHaveProperty('visibility')
  })
})
