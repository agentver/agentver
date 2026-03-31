import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAuditScanResult,
  createFetchedFiles,
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createSharedGitSource,
  createWellKnownSource,
} from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../git/fetcher.js', () => ({
  readFilesFromDirectory: vi.fn(),
}))

vi.mock('../../security/index.js', () => ({
  scanFiles: vi.fn(),
  renderScanResult: vi.fn(),
  SCAN_RULES: [{ id: 'R1' }, { id: 'R2' }, { id: 'R3' }],
}))

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile.js', () => ({
  readLockfile: vi.fn(),
}))

vi.mock('../../storage/canonical.js', () => ({
  getCanonicalSkillPath: vi.fn(),
}))

vi.mock('../../storage/integrity.js', () => ({
  computeSha256FromFiles: vi.fn(),
}))

vi.mock('../../registry/client.js', () => ({
  registryFetch: vi.fn(),
}))

vi.mock('../../output', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { Command } from 'commander'
import { registerVerifyCommand } from '../../commands/verify'
import * as fetcherModule from '../../git/fetcher.js'
import * as outputModule from '../../output'
import * as registryClient from '../../registry/client.js'
import * as securityModule from '../../security/index.js'
import * as canonicalModule from '../../storage/canonical.js'
import * as integrityModule from '../../storage/integrity.js'
import * as lockfileModule from '../../storage/lockfile.js'
import * as manifestModule from '../../storage/manifest.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INTEGRITY_HASH = 'sha256-matchingHash'

function createProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerVerifyCommand(program)
  return program
}

async function runVerify(args: string[]): Promise<void> {
  const program = createProgram()
  await program.parseAsync(['node', 'agentver', ...args])
}

function setupVerifyMocks(overrides?: {
  publisherVerified?: boolean
  integrityMatch?: boolean
  scanVerdict?: 'PASS' | 'WARN' | 'BLOCK'
}) {
  const opts = {
    publisherVerified: true,
    integrityMatch: true,
    scanVerdict: 'PASS' as const,
    ...overrides,
  }

  vi.mocked(registryClient.registryFetch).mockResolvedValue({
    isVerified: opts.publisherVerified,
    publisherVerified: opts.publisherVerified,
    publisherName: 'Test Org',
    publisherSlug: 'test-org',
    authorVerified: true,
    latestVersion: '1.0.0',
    sha256: null,
  })

  const source = createSharedGitSource({ uri: 'github.com/test-org/skills' })
  vi.mocked(manifestModule.readManifest).mockReturnValue(
    createManifest({
      packages: {
        '@test-org/my-skill': createManifestPackage({ source }),
      },
    })
  )
  vi.mocked(lockfileModule.readLockfile).mockReturnValue(
    createLockfile({
      packages: {
        '@test-org/my-skill': createLockfilePackage({
          source,
          integrity: INTEGRITY_HASH,
        }),
      },
    })
  )
  vi.mocked(canonicalModule.getCanonicalSkillPath).mockReturnValue(
    '/project/.agents/skills/@test-org/my-skill'
  )
  vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue(createFetchedFiles(2))
  vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue(
    opts.integrityMatch ? INTEGRITY_HASH : 'sha256-differentHash'
  )
  vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult(opts.scanVerdict))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commands/verify', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalExitCode = process.exitCode

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn().mockReturnValue('/project')
    process.argv = ['node', 'agentver', 'verify']
    process.exit = vi.fn() as never
    process.exitCode = undefined

    vi.mocked(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
    process.exitCode = originalExitCode
  })

  // -------------------------------------------------------------------------
  // 1. Happy path — all checks pass
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('reports overall pass when publisher verified, integrity matches, and audit clean', async () => {
      setupVerifyMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.publisherVerified).toBe(true)
      expect(typed.integrityPassed).toBe(true)
      expect(typed.securityPassed).toBe(true)
      expect(typed.overallPassed).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // 2. Integrity mismatch
  // -------------------------------------------------------------------------

  describe('integrity mismatch', () => {
    it('reports integrity failure when local hash differs from lockfile', async () => {
      setupVerifyMocks({ integrityMatch: false })
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.integrityPassed).toBe(false)
      expect(typed.overallPassed).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // 3. Unverified publisher
  // -------------------------------------------------------------------------

  describe('unverified publisher', () => {
    it('reports publisher not verified', async () => {
      setupVerifyMocks({ publisherVerified: false })
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.publisherVerified).toBe(false)
      expect(typed.overallPassed).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // 4. --strict flag
  // -------------------------------------------------------------------------

  describe('--strict flag', () => {
    it('fails on WARN verdict when strict mode is enabled', async () => {
      setupVerifyMocks({ scanVerdict: 'WARN' })
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill', '--strict'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.securityPassed).toBe(false)
      expect(typed.overallPassed).toBe(false)
    })

    it('passes on WARN verdict without strict mode', async () => {
      setupVerifyMocks({ scanVerdict: 'WARN' })
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.securityPassed).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // 5. Not installed / invalid name
  // -------------------------------------------------------------------------

  describe('not installed', () => {
    it('outputs error for invalid skill name format', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', 'invalid-name-no-slash'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'INVALID_NAME',
        expect.stringContaining('Expected format')
      )
    })

    it('outputs error when no packages installed and no name given', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NO_SKILL',
        expect.stringContaining('No skill name provided')
      )
      expect(process.exitCode).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // 6. Audit finding causes failure
  // -------------------------------------------------------------------------

  describe('audit finding', () => {
    it('reports security failure when scan returns BLOCK', async () => {
      setupVerifyMocks({ scanVerdict: 'BLOCK' })
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.securityPassed).toBe(false)
      expect(typed.overallPassed).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // 7. --json output structure
  // -------------------------------------------------------------------------

  describe('--json output structure', () => {
    it('includes all expected fields in JSON output', async () => {
      setupVerifyMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>

      expect(typed).toHaveProperty('skillName')
      expect(typed).toHaveProperty('publisherVerified')
      expect(typed).toHaveProperty('publisherSlug')
      expect(typed).toHaveProperty('integrityPassed')
      expect(typed).toHaveProperty('securityPassed')
      expect(typed).toHaveProperty('securityRuleCount')
      expect(typed).toHaveProperty('securityIssueCount')
      expect(typed).toHaveProperty('overallPassed')
    })

    it('includes correct skill name in output', async () => {
      setupVerifyMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.skillName).toBe('@test-org/my-skill')
    })
  })

  // -------------------------------------------------------------------------
  // Ambiguous skill name
  // -------------------------------------------------------------------------

  describe('ambiguous skill name', () => {
    it('outputs error when multiple packages installed and no name given', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            '@org/skill-a': createManifestPackage(),
            '@org/skill-b': createManifestPackage(),
          },
        })
      )
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'AMBIGUOUS_SKILL',
        expect.stringContaining('Multiple packages')
      )
      expect(process.exitCode).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Auto-selection with single installed package
  // -------------------------------------------------------------------------

  describe('auto-selection with single installed package', () => {
    it('auto-selects the single installed package when no name argument given', async () => {
      setupVerifyMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.skillName).toBe('@test-org/my-skill')
      expect(typed.overallPassed).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Publisher verification network failure
  // -------------------------------------------------------------------------

  describe('publisher verification network failure', () => {
    it('continues with publisherVerified=false when registryFetch throws', async () => {
      setupVerifyMocks()
      vi.mocked(registryClient.registryFetch).mockRejectedValue(new Error('Network error'))
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.publisherVerified).toBe(false)
      expect(typed.integrityPassed).toBeDefined()
      expect(typed.securityPassed).toBeDefined()
    })

    it('shows warning spinner when registryFetch throws in non-JSON mode', async () => {
      setupVerifyMocks()
      vi.mocked(registryClient.registryFetch).mockRejectedValue(new Error('Network error'))
      const spinner = createNoopSpinner()
      vi.mocked(outputModule.createSpinner).mockReturnValue(
        spinner as unknown as ReturnType<typeof outputModule.createSpinner>
      )

      await runVerify(['verify', '@test-org/my-skill'])

      expect(spinner.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not check publisher')
      )
    })
  })

  // -------------------------------------------------------------------------
  // Integrity check — skill not in manifest
  // -------------------------------------------------------------------------

  describe('integrity check — skill not in manifest', () => {
    it('passes integrity when skill is not installed locally', async () => {
      setupVerifyMocks()
      // Override manifest so the verified skill is NOT present
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.integrityPassed).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Integrity check — empty directory
  // -------------------------------------------------------------------------

  describe('integrity check — empty directory', () => {
    it('fails integrity when installed directory has no files', async () => {
      setupVerifyMocks()
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([])
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.integrityPassed).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Integrity check exception handler
  // -------------------------------------------------------------------------

  describe('integrity check exception handler', () => {
    it('treats integrity check exception as not-a-failure in JSON mode', async () => {
      setupVerifyMocks()
      const source = createSharedGitSource({ uri: 'github.com/test-org/skills' })
      const manifestWithPkg = createManifest({
        packages: { '@test-org/my-skill': createManifestPackage({ source }) },
      })
      // When name arg is provided, readManifest is NOT called for name resolution.
      // 1st call = integrity section (line 221), 2nd call = security section (line 274)
      vi.mocked(manifestModule.readManifest)
        .mockImplementationOnce(() => {
          throw new Error('Disk read error')
        })
        .mockReturnValue(manifestWithPkg)
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.integrityPassed).toBe(true)
    })

    it('treats integrity check exception as not-a-failure in non-JSON mode', async () => {
      setupVerifyMocks()
      const source = createSharedGitSource({ uri: 'github.com/test-org/skills' })
      const manifestWithPkg = createManifest({
        packages: { '@test-org/my-skill': createManifestPackage({ source }) },
      })
      // 1st call = integrity section throws, 2nd call = security section succeeds
      vi.mocked(manifestModule.readManifest)
        .mockImplementationOnce(() => {
          throw new Error('Disk read error')
        })
        .mockReturnValue(manifestWithPkg)

      // Each createSpinner call gets its own spinner so we can inspect individually
      const publisherSpinner = createNoopSpinner()
      const integritySpinner = createNoopSpinner()
      const securitySpinner = createNoopSpinner()
      vi.mocked(outputModule.createSpinner)
        .mockReturnValueOnce(
          publisherSpinner as unknown as ReturnType<typeof outputModule.createSpinner>
        )
        .mockReturnValueOnce(
          integritySpinner as unknown as ReturnType<typeof outputModule.createSpinner>
        )
        .mockReturnValueOnce(
          securitySpinner as unknown as ReturnType<typeof outputModule.createSpinner>
        )

      await runVerify(['verify', '@test-org/my-skill'])

      expect(integritySpinner.warn).toHaveBeenCalledWith(
        expect.stringContaining('Integrity check skipped')
      )
    })
  })

  // -------------------------------------------------------------------------
  // Security scan exception
  // -------------------------------------------------------------------------

  describe('security scan exception', () => {
    it('reports security failure when scanFiles throws in JSON mode', async () => {
      setupVerifyMocks()
      vi.mocked(securityModule.scanFiles).mockRejectedValue(new Error('Scanner crashed'))
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.securityPassed).toBe(false)
      expect(typed.overallPassed).toBe(false)
    })

    it('shows warning spinner when security audit section throws in non-JSON mode', async () => {
      const source = createSharedGitSource({ uri: 'github.com/test-org/skills' })
      const manifestWithPkg = createManifest({
        packages: { '@test-org/my-skill': createManifestPackage({ source }) },
      })
      setupVerifyMocks()
      // When name is provided: 1st readManifest = integrity section, 2nd = security section
      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(manifestWithPkg) // integrity section
        .mockImplementationOnce(() => {
          throw new Error('Manifest read failed')
        })

      const publisherSpinner = createNoopSpinner()
      const integritySpinner = createNoopSpinner()
      const securitySpinner = createNoopSpinner()
      vi.mocked(outputModule.createSpinner)
        .mockReturnValueOnce(
          publisherSpinner as unknown as ReturnType<typeof outputModule.createSpinner>
        )
        .mockReturnValueOnce(
          integritySpinner as unknown as ReturnType<typeof outputModule.createSpinner>
        )
        .mockReturnValueOnce(
          securitySpinner as unknown as ReturnType<typeof outputModule.createSpinner>
        )

      await runVerify(['verify', '@test-org/my-skill'])

      expect(securitySpinner.warn).toHaveBeenCalledWith('Security audit could not run')
    })
  })

  // -------------------------------------------------------------------------
  // Security scan — package not in manifest (skipped)
  // -------------------------------------------------------------------------

  describe('security scan — package not in manifest', () => {
    it('defaults securityPassed to true when skill is not in manifest', async () => {
      const source = createSharedGitSource({ uri: 'github.com/test-org/skills' })
      const manifestWithPkg = createManifest({
        packages: { '@test-org/my-skill': createManifestPackage({ source }) },
      })
      setupVerifyMocks()
      // When name is provided: 1st readManifest = integrity, 2nd = security
      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(manifestWithPkg) // integrity section
        .mockReturnValueOnce(createManifest()) // security section — no packages
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.securityPassed).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Non-JSON mode output
  // -------------------------------------------------------------------------

  describe('non-JSON mode output', () => {
    it('sets process.exitCode to 1 when verification fails', async () => {
      setupVerifyMocks({ publisherVerified: false })

      await runVerify(['verify', '@test-org/my-skill'])

      expect(process.exitCode).toBe(1)
    })

    it('does not set process.exitCode when verification passes', async () => {
      setupVerifyMocks()

      await runVerify(['verify', '@test-org/my-skill'])

      expect(process.exitCode).toBeUndefined()
    })

    it('writes success message to stderr when all checks pass', async () => {
      setupVerifyMocks()
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

      await runVerify(['verify', '@test-org/my-skill'])

      const allOutput = stderrSpy.mock.calls.map(([arg]) => String(arg)).join('')
      expect(allOutput).toContain('verified and safe to use')

      stderrSpy.mockRestore()
    })

    it('writes failure message to stderr when verification fails', async () => {
      setupVerifyMocks({ publisherVerified: false })
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

      await runVerify(['verify', '@test-org/my-skill'])

      const allOutput = stderrSpy.mock.calls.map(([arg]) => String(arg)).join('')
      expect(allOutput).toContain('verification failed')

      stderrSpy.mockRestore()
    })

    it('shows spinner succeed for verified publisher', async () => {
      setupVerifyMocks()
      const spinner = createNoopSpinner()
      vi.mocked(outputModule.createSpinner).mockReturnValue(
        spinner as unknown as ReturnType<typeof outputModule.createSpinner>
      )

      await runVerify(['verify', '@test-org/my-skill'])

      expect(spinner.succeed).toHaveBeenCalledWith(expect.stringContaining('Publisher verified'))
    })

    it('shows spinner fail for unverified publisher', async () => {
      setupVerifyMocks({ publisherVerified: false })
      const spinner = createNoopSpinner()
      vi.mocked(outputModule.createSpinner).mockReturnValue(
        spinner as unknown as ReturnType<typeof outputModule.createSpinner>
      )

      await runVerify(['verify', '@test-org/my-skill'])

      expect(spinner.fail).toHaveBeenCalledWith(expect.stringContaining('Publisher not verified'))
    })

    it('shows spinner succeed for integrity check passed', async () => {
      setupVerifyMocks()
      const spinner = createNoopSpinner()
      vi.mocked(outputModule.createSpinner).mockReturnValue(
        spinner as unknown as ReturnType<typeof outputModule.createSpinner>
      )

      await runVerify(['verify', '@test-org/my-skill'])

      expect(spinner.succeed).toHaveBeenCalledWith(
        expect.stringContaining('Integrity check passed')
      )
    })

    it('shows spinner fail for integrity check failed', async () => {
      setupVerifyMocks({ integrityMatch: false })
      const spinner = createNoopSpinner()
      vi.mocked(outputModule.createSpinner).mockReturnValue(
        spinner as unknown as ReturnType<typeof outputModule.createSpinner>
      )

      await runVerify(['verify', '@test-org/my-skill'])

      expect(spinner.fail).toHaveBeenCalledWith(expect.stringContaining('Integrity check failed'))
    })

    it('shows spinner succeed for security audit passed', async () => {
      setupVerifyMocks()
      const spinner = createNoopSpinner()
      vi.mocked(outputModule.createSpinner).mockReturnValue(
        spinner as unknown as ReturnType<typeof outputModule.createSpinner>
      )

      await runVerify(['verify', '@test-org/my-skill'])

      expect(spinner.succeed).toHaveBeenCalledWith(expect.stringContaining('Security audit passed'))
    })

    it('shows spinner fail for security audit failed', async () => {
      setupVerifyMocks({ scanVerdict: 'BLOCK' })
      const spinner = createNoopSpinner()
      vi.mocked(outputModule.createSpinner).mockReturnValue(
        spinner as unknown as ReturnType<typeof outputModule.createSpinner>
      )

      await runVerify(['verify', '@test-org/my-skill'])

      expect(spinner.fail).toHaveBeenCalledWith(expect.stringContaining('Security audit failed'))
    })

    it('writes error to stderr for invalid skill name', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

      await runVerify(['verify', 'invalid-no-slash'])

      const allOutput = stderrSpy.mock.calls.map(([arg]) => String(arg)).join('')
      expect(allOutput).toContain('Invalid skill name')
      expect(process.exitCode).toBe(1)

      stderrSpy.mockRestore()
    })

    it('writes error to stderr when no packages installed and no name given', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

      await runVerify(['verify'])

      const allOutput = stderrSpy.mock.calls.map(([arg]) => String(arg)).join('')
      expect(allOutput).toContain('No skill name provided')
      expect(process.exitCode).toBe(1)

      stderrSpy.mockRestore()
    })

    it('lists packages when multiple installed and no name given', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            '@org/skill-a': createManifestPackage(),
            '@org/skill-b': createManifestPackage(),
          },
        })
      )
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

      await runVerify(['verify'])

      const allOutput = stderrSpy.mock.calls.map(([arg]) => String(arg)).join('')
      expect(allOutput).toContain('Multiple packages installed')
      expect(process.exitCode).toBe(1)

      stderrSpy.mockRestore()
    })

    it('writes verification header to stderr', async () => {
      setupVerifyMocks()
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

      await runVerify(['verify', '@test-org/my-skill'])

      const allOutput = stderrSpy.mock.calls.map(([arg]) => String(arg)).join('')
      expect(allOutput).toContain('Verifying')

      stderrSpy.mockRestore()
    })
  })

  // -------------------------------------------------------------------------
  // runSecurityScan — empty files path
  // -------------------------------------------------------------------------

  describe('security scan — empty files', () => {
    it('passes security when installed directory has no files', async () => {
      setupVerifyMocks()
      // readFilesFromDirectory returns empty for all calls
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([])
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      // Security scan sees empty files -> returns passed:true with 0 rules
      expect(typed.securityPassed).toBe(true)
      expect(typed.securityRuleCount).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // buildSourceFromManifest — well-known source fallback
  // -------------------------------------------------------------------------

  describe('buildSourceFromManifest with non-git source', () => {
    it('uses fallback source when package has well-known source type', async () => {
      const wellKnownPkg = createManifestPackage({
        source: createWellKnownSource(),
      })
      const source = createSharedGitSource({ uri: 'github.com/test-org/skills' })
      setupVerifyMocks()
      // 1st readManifest (integrity) — standard git package
      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(
          createManifest({
            packages: { '@test-org/my-skill': createManifestPackage({ source }) },
          })
        )
        // 2nd readManifest (security) — well-known source triggers FALLBACK_SOURCE
        .mockReturnValueOnce(
          createManifest({
            packages: { '@test-org/my-skill': wellKnownPkg },
          })
        )
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      // Should still complete — the fallback source is used for scanning
      expect(outputModule.outputSuccess).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Security audit outer catch in JSON mode
  // -------------------------------------------------------------------------

  describe('security audit outer catch in JSON mode', () => {
    it('sets securityPassed to false when security section throws in JSON mode', async () => {
      const source = createSharedGitSource({ uri: 'github.com/test-org/skills' })
      const manifestWithPkg = createManifest({
        packages: { '@test-org/my-skill': createManifestPackage({ source }) },
      })
      setupVerifyMocks()
      // 1st readManifest = integrity, 2nd = security (throws)
      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(manifestWithPkg)
        .mockImplementationOnce(() => {
          throw new Error('Manifest corrupted')
        })
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'verify', '--json']

      await runVerify(['verify', '@test-org/my-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.securityPassed).toBe(false)
      expect(typed.overallPassed).toBe(false)
    })
  })
})
