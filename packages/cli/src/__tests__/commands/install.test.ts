import { createCLIOutputSchema, installResultSchema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FetchedFile, FetchResult, ResolvedRef } from '../../git/types'
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

import * as nodeFs from 'node:fs'
import * as agentDefs from '@agentver/agent-definitions'
import promptsDefault from 'prompts'
import * as gitIndex from '../../git/index.js'
import * as outputModule from '../../output.js'
import * as authModule from '../../registry/auth.js'
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

  // -------------------------------------------------------------------------
  // Well-known URL install path
  // -------------------------------------------------------------------------

  describe('well-known URL install path', () => {
    function setupWellKnownMocks() {
      const files = createFetchedFiles(2)

      vi.mocked(wellknownModule.looksLikeWellKnownUrl).mockReturnValue(true)
      vi.mocked(wellknownModule.parseWellKnownSource).mockReturnValue({
        baseUrl: 'https://skills.example.com',
        skillName: 'test-skill',
      })
      vi.mocked(wellknownModule.fetchWellKnownIndex).mockResolvedValue({
        skills: [{ name: 'test-skill', description: 'A test', files: ['SKILL.md'] }],
      })
      vi.mocked(wellknownModule.fetchWellKnownSkill).mockResolvedValue({
        name: 'test-skill',
        description: 'A test',
        files,
        sourceUrl: 'https://skills.example.com/.well-known/skills/test-skill',
        hostname: 'skills.example.com',
      })
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue(INTEGRITY_HASH)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())
      vi.mocked(canonicalModule.getCanonicalSkillPath).mockReturnValue(
        `/project/.agents/skills/test-skill`
      )
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', paths: ['.claude/skills'] } as ReturnType<
          typeof agentDefs.detectInstalledAgents
        >[0],
      ])

      return { files }
    }

    it('writes manifest with well-known source after successful install', async () => {
      setupWellKnownMocks()

      await installPackage('https://skills.example.com', { agent: 'claude-code' })

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [projectRoot, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(projectRoot).toBe('/project')
      expect(manifest.packages).toHaveProperty('test-skill')
      expect(manifest.packages['test-skill']!.source).toEqual(
        expect.objectContaining({ type: 'well-known', baseUrl: 'https://skills.example.com' })
      )
    })

    it('writes lockfile with integrity hash after successful well-known install', async () => {
      setupWellKnownMocks()

      await installPackage('https://skills.example.com', { agent: 'claude-code' })

      expect(lockfileModule.writeLockfile).toHaveBeenCalledTimes(1)
      const [, lockfile] = vi.mocked(lockfileModule.writeLockfile).mock.calls[0]!
      expect(lockfile.packages['test-skill']!.integrity).toBe(INTEGRITY_HASH)
    })

    it('returns the correct result shape for well-known installs', async () => {
      setupWellKnownMocks()

      const result = await installPackage('https://skills.example.com', { agent: 'claude-code' })

      expect(result).toBeDefined()
      expect(result!.name).toBe('test-skill')
      expect(result!.ref).toBe('well-known')
      expect(result!.agents).toEqual(['claude-code'])
    })

    it('exits with NOT_FOUND when skill is not in the well-known index', async () => {
      setupWellKnownMocks()
      vi.mocked(wellknownModule.parseWellKnownSource).mockReturnValue({
        baseUrl: 'https://skills.example.com',
        skillName: 'nonexistent-skill',
      })

      await expect(
        installPackage('https://skills.example.com/nonexistent-skill', { agent: 'claude-code' })
      ).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })

    it('outputs JSON NOT_FOUND error when skill not found in JSON mode', async () => {
      setupWellKnownMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(wellknownModule.parseWellKnownSource).mockReturnValue({
        baseUrl: 'https://skills.example.com',
        skillName: 'nonexistent-skill',
      })

      await expect(
        installPackage('https://skills.example.com/nonexistent-skill', { agent: 'claude-code' })
      ).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('nonexistent-skill')
      )
    })

    it('exits with AMBIGUOUS_SKILL when multiple skills found and no specifier', async () => {
      setupWellKnownMocks()
      vi.mocked(wellknownModule.parseWellKnownSource).mockReturnValue({
        baseUrl: 'https://skills.example.com',
        skillName: undefined as unknown as string,
      })
      vi.mocked(wellknownModule.fetchWellKnownIndex).mockResolvedValue({
        skills: [
          { name: 'skill-a', description: 'First skill', files: ['SKILL.md'] },
          { name: 'skill-b', description: 'Second skill', files: ['SKILL.md'] },
        ],
      })

      await expect(
        installPackage('https://skills.example.com', { agent: 'claude-code' })
      ).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('outputs AMBIGUOUS_SKILL JSON error when multiple skills and JSON mode', async () => {
      setupWellKnownMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(wellknownModule.parseWellKnownSource).mockReturnValue({
        baseUrl: 'https://skills.example.com',
        skillName: undefined as unknown as string,
      })
      vi.mocked(wellknownModule.fetchWellKnownIndex).mockResolvedValue({
        skills: [
          { name: 'skill-a', description: 'First skill', files: ['SKILL.md'] },
          { name: 'skill-b', description: 'Second skill', files: ['SKILL.md'] },
        ],
      })

      await expect(
        installPackage('https://skills.example.com', { agent: 'claude-code' })
      ).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'AMBIGUOUS_SKILL',
        expect.stringContaining('skill-a')
      )
    })

    it('exits with NO_FILES when well-known fetch returns empty files', async () => {
      setupWellKnownMocks()
      vi.mocked(wellknownModule.fetchWellKnownSkill).mockResolvedValue({
        name: 'test-skill',
        description: 'A test',
        files: [],
        sourceUrl: 'https://skills.example.com/.well-known/skills/test-skill',
        hostname: 'skills.example.com',
      })

      await expect(
        installPackage('https://skills.example.com', { agent: 'claude-code' })
      ).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('outputs NO_FILES JSON error when no files and JSON mode', async () => {
      setupWellKnownMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(wellknownModule.fetchWellKnownSkill).mockResolvedValue({
        name: 'test-skill',
        description: 'A test',
        files: [],
        sourceUrl: 'https://skills.example.com/.well-known/skills/test-skill',
        hostname: 'skills.example.com',
      })

      await expect(
        installPackage('https://skills.example.com', { agent: 'claude-code' })
      ).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NO_FILES',
        expect.stringContaining('test-skill')
      )
    })

    it('does not write manifest or lockfile in dry-run mode', async () => {
      setupWellKnownMocks()

      const result = await installPackage('https://skills.example.com', {
        agent: 'claude-code',
        dryRun: true,
      })

      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
      expect(lockfileModule.writeLockfile).not.toHaveBeenCalled()
      expect(result!.name).toBe('test-skill')
    })

    it('outputs JSON success in dry-run mode when JSON mode is active', async () => {
      setupWellKnownMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await installPackage('https://skills.example.com', {
        agent: 'claude-code',
        dryRun: true,
      })

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as Record<
        string,
        unknown
      >
      expect(data.name).toBe('test-skill')
      expect((data.source as Record<string, unknown>).type).toBe('well-known')
    })

    it('outputs JSON success with well-known source type on non-dry-run install', async () => {
      setupWellKnownMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await installPackage('https://skills.example.com', { agent: 'claude-code' })

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const data = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as Record<
        string,
        unknown
      >
      expect(data.name).toBe('test-skill')
      expect((data.source as Record<string, unknown>).type).toBe('well-known')
    })

    it('catches unexpected errors and exits with INSTALL_FAILED in JSON mode', async () => {
      vi.mocked(wellknownModule.looksLikeWellKnownUrl).mockReturnValue(true)
      vi.mocked(wellknownModule.parseWellKnownSource).mockImplementation(() => {
        throw new Error('Unexpected parse failure')
      })
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await expect(
        installPackage('https://skills.example.com', { agent: 'claude-code' })
      ).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'INSTALL_FAILED',
        expect.stringContaining('Unexpected parse failure')
      )
    })

    it('catches unexpected errors and exits in non-JSON mode', async () => {
      vi.mocked(wellknownModule.looksLikeWellKnownUrl).mockReturnValue(true)
      vi.mocked(wellknownModule.parseWellKnownSource).mockImplementation(() => {
        throw new Error('Unexpected parse failure')
      })

      await expect(
        installPackage('https://skills.example.com', { agent: 'claude-code' })
      ).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // resolveSource with platform name resolution
  // -------------------------------------------------------------------------

  describe('resolveSource platform name resolution', () => {
    it('resolves short name via platform when platformUrl is configured', async () => {
      setupHappyPathMocks()
      vi.mocked(configModule.readConfig).mockReturnValue({
        platformUrl: 'https://app.agentver.com',
      })
      vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'test-token' })

      // Mock global fetch for the platform resolve endpoint
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            gitUri: 'github.com/resolved-org/resolved-repo',
            gitPath: 'skills/resolved-skill',
            gitRef: 'main',
          }),
      })
      globalThis.fetch = mockFetch

      // The resolved source is then parsed via parseGitSource
      const resolvedGitSource = createGitSource({
        host: 'github.com',
        owner: 'resolved-org',
        repo: 'resolved-repo',
        path: 'skills/resolved-skill',
        ref: 'main',
      })
      vi.mocked(gitIndex.parseGitSource).mockReturnValue(resolvedGitSource)

      const result = await installPackage('my-skill', { agent: 'claude-code' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/resolve?name=my-skill'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        })
      )
      expect(result).toBeDefined()
      expect(result!.name).toBe('resolved-skill')
    })

    it('appends user-specified ref instead of platform-provided ref', async () => {
      setupHappyPathMocks()
      vi.mocked(configModule.readConfig).mockReturnValue({
        platformUrl: 'https://app.agentver.com',
      })
      vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'test-token' })

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            gitUri: 'github.com/resolved-org/resolved-repo',
            gitPath: 'skills/resolved-skill',
            gitRef: 'main',
          }),
      })
      globalThis.fetch = mockFetch

      const resolvedGitSource = createGitSource({
        host: 'github.com',
        owner: 'resolved-org',
        repo: 'resolved-repo',
        path: 'skills/resolved-skill',
        ref: 'v2.0',
      })
      vi.mocked(gitIndex.parseGitSource).mockReturnValue(resolvedGitSource)

      await installPackage('my-skill@v2.0', { agent: 'claude-code' })

      // parseGitSource should have been called with the resolved URL containing the user ref
      expect(gitIndex.parseGitSource).toHaveBeenCalledWith(expect.stringContaining('@v2.0'))
    })

    it('exits with VALIDATION_ERROR when short name used without platformUrl', async () => {
      setupHappyPathMocks()
      vi.mocked(configModule.readConfig).mockReturnValue({})

      // 'my-skill' does not look like a git URL (no dots in first segment, fewer than 3 segments)
      // so resolveSource will try platform resolution and fail
      await expect(installPackage('my-skill', { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('outputs INSTALL_FAILED JSON error when short name used without platformUrl in JSON mode', async () => {
      setupHappyPathMocks()
      vi.mocked(configModule.readConfig).mockReturnValue({})
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await expect(installPackage('my-skill', { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'INSTALL_FAILED',
        expect.stringContaining("doesn't look like a Git URL")
      )
    })
  })

  // -------------------------------------------------------------------------
  // Security WARN flow
  // -------------------------------------------------------------------------

  describe('security audit WARN', () => {
    it('proceeds without prompting in JSON mode when scan returns WARN', async () => {
      setupHappyPathMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('WARN'))

      const result = await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      expect(result).toBeDefined()
      expect(result!.name).toBe(DERIVED_NAME)
      // Should not have called prompts since JSON mode bypasses interactive prompt
      expect(promptsDefault).not.toHaveBeenCalled()
    })

    it('includes security warnings in JSON output when scan returns WARN', async () => {
      setupHappyPathMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('WARN'))

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      const callArgs = vi.mocked(outputModule.outputSuccess).mock.calls
      const lastCall = callArgs[callArgs.length - 1]!
      const warnings = lastCall[1] as string[] | undefined
      expect(warnings).toBeDefined()
      expect(warnings!.some((w) => w.includes('warning'))).toBe(true)
    })

    it('includes audit data with findings in JSON output when scan returns WARN', async () => {
      setupHappyPathMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('WARN'))

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      const callArgs = vi.mocked(outputModule.outputSuccess).mock.calls
      const lastCall = callArgs[callArgs.length - 1]!
      const data = lastCall[0] as Record<string, unknown>
      const audit = data.audit as Record<string, unknown>
      expect(audit.passed).toBe(true)
      expect(audit.findings).toBeGreaterThan(0)
    })

    it('prompts user in non-JSON mode and cancels on decline', async () => {
      setupHappyPathMocks()
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('WARN'))
      vi.mocked(promptsDefault).mockResolvedValue({ proceed: false })

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(ExitError)

      expect(promptsDefault).toHaveBeenCalled()
      expect(process.exit).toHaveBeenCalledWith(0)
    })

    it('prompts user in non-JSON mode and proceeds on confirm', async () => {
      setupHappyPathMocks()
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('WARN'))
      vi.mocked(promptsDefault).mockResolvedValue({ proceed: true })

      const result = await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      expect(promptsDefault).toHaveBeenCalled()
      expect(result).toBeDefined()
      expect(result!.name).toBe(DERIVED_NAME)
      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // installToCustomPath via --path flag
  // -------------------------------------------------------------------------

  describe('--path flag (custom path install)', () => {
    it('writes files to the specified custom path', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', path: 'custom/output' })

      // Files should be written via writeFileSync to the resolved custom path
      expect(nodeFs.writeFileSync).toHaveBeenCalled()
      const writeCalls = vi.mocked(nodeFs.writeFileSync).mock.calls
      const writtenPaths = writeCalls.map((c) => String(c[0]))
      // The resolved path should be under /project/custom/output
      expect(writtenPaths.some((p) => p.startsWith('/project/custom/output'))).toBe(true)
    })

    it('writes manifest and lockfile for custom path installs', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', path: 'custom/output' })

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      expect(lockfileModule.writeLockfile).toHaveBeenCalledTimes(1)
    })

    it('skips files with path traversal (../) in their path', async () => {
      setupHappyPathMocks()
      const maliciousFiles = [
        { path: 'SKILL.md', content: '# Good file', size: 11 },
        { path: '../../../etc/passwd', content: 'malicious', size: 9 },
      ]
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: maliciousFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })

      await installPackage(TEST_SOURCE, { agent: 'claude-code', path: 'custom/output' })

      const writeCalls = vi.mocked(nodeFs.writeFileSync).mock.calls
      const writtenPaths = writeCalls.map((c) => String(c[0]))
      // The path-traversal file should NOT have been written
      expect(writtenPaths.some((p) => p.includes('etc/passwd'))).toBe(false)
      // But the legitimate file should have been written
      expect(writtenPaths.some((p) => p.includes('SKILL.md'))).toBe(true)
    })

    it('does not write files in dry-run mode with custom path', async () => {
      setupHappyPathMocks()

      const result = await installPackage(TEST_SOURCE, {
        agent: 'claude-code',
        path: 'custom/output',
        dryRun: true,
      })

      expect(nodeFs.writeFileSync).not.toHaveBeenCalled()
      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
      expect(result).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // installAgentConfig (AGENT_CONFIG package type)
  // -------------------------------------------------------------------------

  describe('AGENT_CONFIG package type', () => {
    function createAgentConfigFiles(): FetchedFile[] {
      const configContent = '# My Config\n\nRules for the agent.\n'
      return [{ path: 'CLAUDE.md', content: configContent, size: configContent.length }]
    }

    it('installs via config path when package contains CLAUDE.md', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })
      vi.mocked(agentDefs.getConfigFilePath).mockReturnValue('.claude/skills/test-skill/CLAUDE.md')

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      // writeFileSync should be called for the config file path
      expect(nodeFs.writeFileSync).toHaveBeenCalled()
      const writeCalls = vi.mocked(nodeFs.writeFileSync).mock.calls
      const writtenPaths = writeCalls.map((c) => String(c[0]))
      expect(writtenPaths.some((p) => p.includes('.claude/skills/test-skill/CLAUDE.md'))).toBe(true)
    })

    it('does not write config file in dry-run mode for AGENT_CONFIG', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })
      vi.mocked(agentDefs.getConfigFilePath).mockReturnValue('.claude/skills/test-skill/CLAUDE.md')

      const result = await installPackage(TEST_SOURCE, { agent: 'claude-code', dryRun: true })

      // In dry-run mode, writeFileSync should NOT be called for config files
      // (it might be called for canonical path, but not for config specifically)
      expect(nodeFs.writeFileSync).not.toHaveBeenCalled()
      expect(result).toBeDefined()
    })

    it('skips agents where getConfigFilePath returns null', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })
      vi.mocked(agentDefs.getConfigFilePath).mockReturnValue(null)

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      // writeFileSync should not be called for the config since getConfigFilePath returned null
      // (manifest/lockfile writes go through their own mocked functions, not writeFileSync)
      expect(nodeFs.writeFileSync).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // --no-detect without --agent
  // -------------------------------------------------------------------------

  describe('--no-detect without --agent', () => {
    it('exits with error when --no-detect used without --agent', async () => {
      setupHappyPathMocks()

      await expect(installPackage(TEST_SOURCE, { detect: false })).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })

    it('outputs VALIDATION_ERROR in JSON mode when --no-detect used without --agent', async () => {
      setupHappyPathMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await expect(installPackage(TEST_SOURCE, { detect: false })).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.stringContaining('--agent')
      )
    })

    it('succeeds when --no-detect is used together with --agent', async () => {
      setupHappyPathMocks()

      const result = await installPackage(TEST_SOURCE, {
        detect: false,
        agent: 'claude-code',
      })

      expect(result).toBeDefined()
      expect(result!.agents).toEqual(['claude-code'])
      expect(agentDefs.detectInstalledAgents).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Well-known URL + --no-detect without --agent
  // -------------------------------------------------------------------------

  describe('well-known URL with --no-detect and no --agent', () => {
    it('exits with VALIDATION_ERROR when --no-detect used without --agent on well-known source', async () => {
      vi.mocked(wellknownModule.looksLikeWellKnownUrl).mockReturnValue(true)
      vi.mocked(wellknownModule.parseWellKnownSource).mockReturnValue({
        baseUrl: 'https://skills.example.com',
        skillName: 'test-skill',
      })
      vi.mocked(wellknownModule.fetchWellKnownIndex).mockResolvedValue({
        skills: [{ name: 'test-skill', description: 'A test', files: ['SKILL.md'] }],
      })
      vi.mocked(wellknownModule.fetchWellKnownSkill).mockResolvedValue({
        name: 'test-skill',
        description: 'A test',
        files: createFetchedFiles(2),
        sourceUrl: 'https://skills.example.com/.well-known/skills/test-skill',
        hostname: 'skills.example.com',
      })
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue(INTEGRITY_HASH)

      await expect(installPackage('https://skills.example.com', { detect: false })).rejects.toThrow(
        ExitError
      )

      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })
})
