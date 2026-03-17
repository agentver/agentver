import { createCLIOutputSchema, installResultSchema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FetchResult, ResolvedRef } from '../../git/types'
import {
  createAuditScanResult,
  createFetchedFiles,
  createGitSource,
  createLockfile,
  createManifest,
} from '../helpers/fixtures'

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any import of the SUT
// ---------------------------------------------------------------------------

vi.mock('../../git/index.js', () => ({
  parseGitSource: vi.fn(),
  resolveRef: vi.fn(),
  fetchFiles: vi.fn(),
}))

vi.mock('../../storage/manifest', () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile', () => ({
  readLockfile: vi.fn(),
  writeLockfile: vi.fn(),
}))

vi.mock('../../storage/canonical', () => ({
  getCanonicalSkillPath: vi.fn(),
  createAgentSymlinks: vi.fn(),
  isSymlinkedInstall: vi.fn(),
  removeAgentSymlinks: vi.fn(),
  removeCanonicalDirectory: vi.fn(),
}))

vi.mock('../../storage/integrity', () => ({
  computeSha256FromFiles: vi.fn(),
}))

vi.mock('../../security/index.js', () => ({
  scanFiles: vi.fn(),
  renderScanResult: vi.fn(),
}))

vi.mock('../../registry/auth.js', () => ({
  getCredentials: vi.fn(),
  isAuthenticated: vi.fn(),
}))

vi.mock('../../registry/config.js', () => ({
  readConfig: vi.fn(),
  getPlatformUrl: vi.fn(),
}))

vi.mock('../../registry/reporter.js', () => ({
  reportInstallation: vi.fn(),
  reportRemoval: vi.fn(),
}))

vi.mock('../../wellknown/index.js', () => ({
  looksLikeWellKnownUrl: vi.fn().mockReturnValue(false),
  parseWellKnownSource: vi.fn(),
  fetchWellKnownIndex: vi.fn(),
  fetchWellKnownSkill: vi.fn(),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

vi.mock('@agentver/agent-definitions', () => ({
  detectInstalledAgents: vi.fn(),
  getConfigFilePath: vi.fn(),
  getSkillPlacementPath: vi.fn(),
  composeConfigs: vi.fn(),
  isComposedConfig: vi.fn(),
  parseComposedSections: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('prompts', () => ({ default: vi.fn() }))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { installPackage } from '../../commands/install'

// ---------------------------------------------------------------------------
// Mock module imports (typed references)
// ---------------------------------------------------------------------------

import * as agentDefs from '@agentver/agent-definitions'
import * as gitIndex from '../../git/index.js'
import * as outputModule from '../../output.js'
import * as configModule from '../../registry/config.js'
import * as reporterModule from '../../registry/reporter.js'
import * as securityModule from '../../security/index.js'
import * as canonicalModule from '../../storage/canonical'
import * as integrityModule from '../../storage/integrity'
import * as lockfileModule from '../../storage/lockfile'
import * as manifestModule from '../../storage/manifest'
import * as wellknownModule from '../../wellknown/index.js'

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

// deriveSkillName extracts the last path segment — for path 'skills/test-skill' => 'test-skill'
const DERIVED_NAME = 'test-skill'
const TEST_SOURCE = 'github.com/test-org/test-repo/skills/test-skill@main'
const RESOLVED_SHA = 'abc1234567890abcdef1234567890abcdef1234567'
const INTEGRITY_HASH = 'sha256-testIntegrityHash123'

/** Sentinel error thrown by our process.exit mock to halt execution */
class ExitError extends Error {
  code: number
  constructor(code: number) {
    super(`process.exit(${code})`)
    this.code = code
  }
}

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

function setupHappyPathMocks() {
  const gitSource = createGitSource()
  const files = createFetchedFiles(2)
  const resolved: ResolvedRef = { source: gitSource, commitSha: RESOLVED_SHA }
  const fetchResult: FetchResult = {
    files,
    commitSha: RESOLVED_SHA,
    source: gitSource,
  }

  vi.mocked(gitIndex.parseGitSource).mockReturnValue(gitSource)
  vi.mocked(gitIndex.resolveRef).mockResolvedValue(resolved)
  vi.mocked(gitIndex.fetchFiles).mockResolvedValue(fetchResult)
  vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue(INTEGRITY_HASH)
  vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
  vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
  vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())
  vi.mocked(canonicalModule.getCanonicalSkillPath).mockReturnValue(
    `/project/.agents/skills/${DERIVED_NAME}`
  )
  vi.mocked(configModule.readConfig).mockReturnValue({})
  vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)
  vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
    { id: 'claude-code', name: 'Claude Code', paths: ['.claude/skills'] } as ReturnType<
      typeof agentDefs.detectInstalledAgents
    >[0],
  ])

  return { gitSource, files, resolved, fetchResult }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commands/install', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit

  beforeEach(() => {
    vi.clearAllMocks()

    process.cwd = vi.fn().mockReturnValue('/project')
    process.argv = ['node', 'agentver', 'install']
    // Make process.exit throw so execution halts as it would in real usage
    process.exit = vi.fn().mockImplementation((code: number) => {
      throw new ExitError(code)
    }) as never

    vi.mocked(outputModule.createSpinner).mockReturnValue(createNoopSpinner() as never)
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
    vi.mocked(wellknownModule.looksLikeWellKnownUrl).mockReturnValue(false)
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
  })

  // -------------------------------------------------------------------------
  // 1. Happy path git install
  // -------------------------------------------------------------------------

  describe('happy path git install', () => {
    it('writes manifest with package entry after successful install', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [projectRoot, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(projectRoot).toBe('/project')
      expect(manifest.packages).toHaveProperty(DERIVED_NAME)
      expect(manifest.packages[DERIVED_NAME]!.agents).toEqual(['claude-code'])
    })

    it('writes lockfile with integrity hash after successful install', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      expect(lockfileModule.writeLockfile).toHaveBeenCalledTimes(1)
      const [, lockfile] = vi.mocked(lockfileModule.writeLockfile).mock.calls[0]!
      expect(lockfile.packages[DERIVED_NAME]!.integrity).toBe(INTEGRITY_HASH)
    })

    it('creates agent symlinks for the target agent', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      expect(canonicalModule.createAgentSymlinks).toHaveBeenCalledWith(
        '/project',
        DERIVED_NAME,
        ['claude-code'],
        'project'
      )
    })

    it('stores the resolved commit SHA in the lockfile source, not the original ref', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      const [, lockfile] = vi.mocked(lockfileModule.writeLockfile).mock.calls[0]!
      const source = lockfile.packages[DERIVED_NAME]!.source
      expect(source.type).toBe('git')
      if (source.type === 'git') {
        expect(source.commit).toBe(RESOLVED_SHA)
      }
    })

    it('returns the correct InstallResult shape', async () => {
      setupHappyPathMocks()

      const result = await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      expect(result).toBeDefined()
      expect(result!.name).toBe(DERIVED_NAME)
      expect(result!.commitSha).toBe(RESOLVED_SHA)
      expect(result!.agents).toEqual(['claude-code'])
    })
  })

  // -------------------------------------------------------------------------
  // 2. Security audit BLOCK
  // -------------------------------------------------------------------------

  describe('security audit BLOCK', () => {
    it('calls process.exit when security scan returns BLOCK verdict', async () => {
      setupHappyPathMocks()
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('BLOCK'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('does not write manifest when scan blocks installation', async () => {
      setupHappyPathMocks()
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('BLOCK'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })

    it('does not write lockfile when scan blocks installation', async () => {
      setupHappyPathMocks()
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('BLOCK'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(lockfileModule.writeLockfile).not.toHaveBeenCalled()
    })

    it('outputs JSON error when in JSON mode and scan blocks', async () => {
      setupHappyPathMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('BLOCK'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'SECURITY_BLOCK',
        expect.stringContaining('finding')
      )
    })
  })

  // -------------------------------------------------------------------------
  // 3. Security audit skip
  // -------------------------------------------------------------------------

  describe('security audit skip with --skipAudit', () => {
    it('does not call scanFiles when skipAudit is true', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', skipAudit: true })

      expect(securityModule.scanFiles).not.toHaveBeenCalled()
    })

    it('still writes manifest and lockfile when audit is skipped', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', skipAudit: true })

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      expect(lockfileModule.writeLockfile).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // 4. Dry run
  // -------------------------------------------------------------------------

  describe('--dry-run', () => {
    it('does not write manifest in dry-run mode', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', dryRun: true })

      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })

    it('does not write lockfile in dry-run mode', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', dryRun: true })

      expect(lockfileModule.writeLockfile).not.toHaveBeenCalled()
    })

    it('does not call reportInstallation in dry-run mode', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', dryRun: true })

      expect(reporterModule.reportInstallation).not.toHaveBeenCalled()
    })

    it('still returns the install result with package name and SHA', async () => {
      setupHappyPathMocks()

      const result = await installPackage(TEST_SOURCE, { agent: 'claude-code', dryRun: true })

      expect(result).toBeDefined()
      expect(result!.name).toBe(DERIVED_NAME)
      expect(result!.commitSha).toBe(RESOLVED_SHA)
    })
  })

  // -------------------------------------------------------------------------
  // 5. JSON output
  // -------------------------------------------------------------------------

  describe('--json output', () => {
    it('calls outputSuccess with data matching installResultSchema', async () => {
      setupHappyPathMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const callArgs = vi.mocked(outputModule.outputSuccess).mock.calls
      const lastCall = callArgs[callArgs.length - 1]!
      const data = lastCall[0]

      const outputSchema = createCLIOutputSchema(installResultSchema)
      const envelope = { success: true, data }
      const result = outputSchema.safeParse(envelope)
      expect(result.success).toBe(true)
    })

    it('includes correct source type and agents in JSON output', async () => {
      setupHappyPathMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      const callArgs = vi.mocked(outputModule.outputSuccess).mock.calls
      const lastCall = callArgs[callArgs.length - 1]!
      const data = lastCall[0] as Record<string, unknown>

      expect(data.name).toBe(DERIVED_NAME)
      expect(data.agents).toEqual(['claude-code'])
      expect((data.source as Record<string, unknown>).type).toBe('git')
    })

    it('includes audit data in JSON output', async () => {
      setupHappyPathMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      const callArgs = vi.mocked(outputModule.outputSuccess).mock.calls
      const lastCall = callArgs[callArgs.length - 1]!
      const data = lastCall[0] as Record<string, unknown>

      const audit = data.audit as Record<string, unknown>
      expect(audit).toBeDefined()
      expect(audit.passed).toBe(true)
      expect(typeof audit.findings).toBe('number')
      expect(typeof audit.blockers).toBe('number')
    })
  })

  // -------------------------------------------------------------------------
  // 6. --agent flag
  // -------------------------------------------------------------------------

  describe('--agent flag', () => {
    it('uses only the specified agent instead of auto-detecting', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'cursor' })

      expect(agentDefs.detectInstalledAgents).not.toHaveBeenCalled()
      expect(canonicalModule.createAgentSymlinks).toHaveBeenCalledWith(
        '/project',
        DERIVED_NAME,
        ['cursor'],
        'project'
      )
    })

    it('stores the specified agent in the manifest', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'cursor' })

      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(manifest.packages[DERIVED_NAME]!.agents).toEqual(['cursor'])
    })
  })

  // -------------------------------------------------------------------------
  // 7. Agent detection — no agents
  // -------------------------------------------------------------------------

  describe('agent detection and no-agents scenario', () => {
    it('warns when no agents are detected and no --agent specified', async () => {
      setupHappyPathMocks()
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([])

      const result = await installPackage(TEST_SOURCE, {})

      expect(result).toBeDefined()
      expect(result!.agents).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // 8. Git fetch failure
  // -------------------------------------------------------------------------

  describe('git fetch failure', () => {
    it('calls process.exit when fetchFiles rejects', async () => {
      setupHappyPathMocks()
      vi.mocked(gitIndex.fetchFiles).mockRejectedValue(new Error('Network timeout whilst fetching'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('does not write manifest when fetchFiles fails', async () => {
      setupHappyPathMocks()
      vi.mocked(gitIndex.fetchFiles).mockRejectedValue(new Error('Network timeout whilst fetching'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })

    it('outputs JSON error when in JSON mode and fetch fails', async () => {
      setupHappyPathMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(gitIndex.fetchFiles).mockRejectedValue(new Error('Network timeout whilst fetching'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'INSTALL_FAILED',
        expect.stringContaining('Network timeout')
      )
    })
  })

  // -------------------------------------------------------------------------
  // 9. Invalid source format
  // -------------------------------------------------------------------------

  describe('invalid source format', () => {
    it('calls process.exit when parseGitSource throws for garbage input', async () => {
      setupHappyPathMocks()
      vi.mocked(gitIndex.parseGitSource).mockImplementation(() => {
        throw new Error('Invalid git source "garbage" — expected format: host/owner/repo')
      })
      vi.mocked(configModule.readConfig).mockReturnValue({})

      await expect(installPackage('garbage', { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('does not call resolveRef when source is invalid', async () => {
      setupHappyPathMocks()
      vi.mocked(gitIndex.parseGitSource).mockImplementation(() => {
        throw new Error('Invalid git source')
      })
      vi.mocked(configModule.readConfig).mockReturnValue({})

      await expect(installPackage('garbage', { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(gitIndex.resolveRef).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 10. Platform reporting
  // -------------------------------------------------------------------------

  describe('platform reporting', () => {
    it('calls reportInstallation after successful git install', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      expect(reporterModule.reportInstallation).toHaveBeenCalledTimes(1)
      expect(reporterModule.reportInstallation).toHaveBeenCalledWith(
        DERIVED_NAME,
        expect.objectContaining({ type: 'git' }),
        ['claude-code'],
        RESOLVED_SHA
      )
    })
  })

  // -------------------------------------------------------------------------
  // 11. No platform
  // -------------------------------------------------------------------------

  describe('no platform connection', () => {
    it('still calls reportInstallation (reporter internally gates on platformUrl)', async () => {
      setupHappyPathMocks()
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      // reportInstallation is always called — it checks platformUrl internally
      expect(reporterModule.reportInstallation).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // 12. Ref resolved to SHA
  // -------------------------------------------------------------------------

  describe('ref resolution to commit SHA', () => {
    it('stores the resolved SHA in manifest source commit field', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      const source = manifest.packages[DERIVED_NAME]!.source
      expect(source.type).toBe('git')
      if (source.type === 'git') {
        expect(source.commit).toBe(RESOLVED_SHA)
      }
    })

    it('lockfile contains the resolved commit SHA, not the original ref string', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      const [, lockfile] = vi.mocked(lockfileModule.writeLockfile).mock.calls[0]!
      const source = lockfile.packages[DERIVED_NAME]!.source
      expect(source.type).toBe('git')
      if (source.type === 'git') {
        expect(source.commit).toBe(RESOLVED_SHA)
        expect(source.ref).toBe('main')
      }
    })
  })

  // -------------------------------------------------------------------------
  // Additional edge cases
  // -------------------------------------------------------------------------

  describe('global scope', () => {
    it('passes global scope to createAgentSymlinks', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', global: true })

      expect(canonicalModule.createAgentSymlinks).toHaveBeenCalledWith(
        '/project',
        DERIVED_NAME,
        ['claude-code'],
        'global'
      )
    })
  })

  describe('resolveRef failure', () => {
    it('calls process.exit when resolveRef rejects', async () => {
      setupHappyPathMocks()
      vi.mocked(gitIndex.resolveRef).mockRejectedValue(new Error('Could not resolve ref "main"'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })
  })

  describe('no files returned from fetch', () => {
    it('calls process.exit when fetchFiles returns an empty array', async () => {
      setupHappyPathMocks()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: [],
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })
  })
})
