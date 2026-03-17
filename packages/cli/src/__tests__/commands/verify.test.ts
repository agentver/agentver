import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAuditScanResult,
  createFetchedFiles,
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createSharedGitSource,
} from '../helpers/fixtures'

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

function createNoopSpinner() {
  return {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  }
}

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

    vi.mocked(outputModule.createSpinner).mockReturnValue(createNoopSpinner() as never)
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
    })
  })
})
