import { AgentverError, createCLIOutputSchema, installResultSchema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FetchedFile, FetchResult, ResolvedRef } from '../../git/types'
import {
  createAuditScanResult,
  createFetchedFiles,
  createGitSource,
  createLockfile,
  createManifest,
  createSkillMd,
} from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

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
  getAgentPlacementPath: vi.fn(),
  getCommandPlacementPath: vi.fn(),
  composeConfigs: vi.fn(),
  isComposedConfig: vi.fn(),
  parseComposedSections: vi.fn(),
  translateConfig: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/mock-home'),
}))

vi.mock('prompts', () => ({ default: vi.fn() }))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { Command } from 'commander'
import { installPackage, parseAgentverUri, registerInstallCommand } from '../../commands/install'

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
    { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
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

    vi.mocked(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
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
    it('throws AgentverError when security scan returns BLOCK verdict', async () => {
      setupHappyPathMocks()
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('BLOCK'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(
        AgentverError
      )
      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(/finding/)

      expect(process.exit).not.toHaveBeenCalled()
    })

    it('does not write manifest when scan blocks installation', async () => {
      setupHappyPathMocks()
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('BLOCK'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(
        AgentverError
      )

      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })

    it('does not write lockfile when scan blocks installation', async () => {
      setupHappyPathMocks()
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('BLOCK'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(
        AgentverError
      )

      expect(lockfileModule.writeLockfile).not.toHaveBeenCalled()
    })

    it('throws with SECURITY_BLOCK code when scan blocks in JSON mode', async () => {
      setupHappyPathMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('BLOCK'))

      try {
        await installPackage(TEST_SOURCE, { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('SECURITY_BLOCK')
      }
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
    it('throws AgentverError when fetchFiles rejects', async () => {
      setupHappyPathMocks()
      vi.mocked(gitIndex.fetchFiles).mockRejectedValue(new Error('Network timeout whilst fetching'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(
        AgentverError
      )

      expect(process.exit).not.toHaveBeenCalled()
    })

    it('does not write manifest when fetchFiles fails', async () => {
      setupHappyPathMocks()
      vi.mocked(gitIndex.fetchFiles).mockRejectedValue(new Error('Network timeout whilst fetching'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(
        AgentverError
      )

      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })

    it('throws with INSTALL_FAILED code containing the error message', async () => {
      setupHappyPathMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(gitIndex.fetchFiles).mockRejectedValue(new Error('Network timeout whilst fetching'))

      try {
        await installPackage(TEST_SOURCE, { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('INSTALL_FAILED')
        expect((error as AgentverError).message).toContain('Network timeout')
      }
    })
  })

  // -------------------------------------------------------------------------
  // 9. Invalid source format
  // -------------------------------------------------------------------------

  describe('invalid source format', () => {
    it('throws AgentverError when short name used without platformUrl', async () => {
      setupHappyPathMocks()
      vi.mocked(configModule.readConfig).mockReturnValue({})

      await expect(installPackage('garbage', { agent: 'claude-code' })).rejects.toThrow(
        AgentverError
      )

      expect(process.exit).not.toHaveBeenCalled()
    })

    it('does not call resolveRef when source is invalid', async () => {
      setupHappyPathMocks()
      vi.mocked(configModule.readConfig).mockReturnValue({})

      await expect(installPackage('garbage', { agent: 'claude-code' })).rejects.toThrow(
        AgentverError
      )

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
    it('throws AgentverError when resolveRef rejects', async () => {
      setupHappyPathMocks()
      vi.mocked(gitIndex.resolveRef).mockRejectedValue(new Error('Could not resolve ref "main"'))

      await expect(installPackage(TEST_SOURCE, { agent: 'claude-code' })).rejects.toThrow(
        AgentverError
      )

      expect(process.exit).not.toHaveBeenCalled()
      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })
  })

  describe('no files returned from fetch', () => {
    it('throws AgentverError with NO_FILES when fetchFiles returns an empty array', async () => {
      setupHappyPathMocks()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: [],
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })

      try {
        await installPackage(TEST_SOURCE, { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('NO_FILES')
      }

      expect(process.exit).not.toHaveBeenCalled()
      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // skills/ prefix retry when direct path returns no files
  // -------------------------------------------------------------------------

  describe('skills/ prefix retry fallback', () => {
    it('retries with skills/ prefix and succeeds when direct path returns no files', async () => {
      const gitSource = createGitSource({ path: 'my-skill' })
      const files = createFetchedFiles(2)
      const resolved: ResolvedRef = { source: gitSource, commitSha: RESOLVED_SHA }
      const emptyResult: FetchResult = { files: [], commitSha: RESOLVED_SHA, source: gitSource }
      const prefixedSource = { ...gitSource, path: `skills/${gitSource.path}` }
      const prefixedResult: FetchResult = {
        files,
        commitSha: RESOLVED_SHA,
        source: prefixedSource,
      }

      vi.mocked(gitIndex.parseGitSource).mockReturnValue(gitSource)
      vi.mocked(gitIndex.resolveRef).mockResolvedValue(resolved)
      // First call (direct path) returns empty, second call (skills/ prefix) returns files
      vi.mocked(gitIndex.fetchFiles)
        .mockResolvedValueOnce(emptyResult)
        .mockResolvedValueOnce(prefixedResult)
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue(INTEGRITY_HASH)
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())
      vi.mocked(canonicalModule.getCanonicalSkillPath).mockReturnValue(
        '/project/.agents/skills/my-skill'
      )
      vi.mocked(configModule.readConfig).mockReturnValue({})
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
      ])

      const result = await installPackage('github.com/test-org/test-repo/my-skill@main', {
        agent: 'claude-code',
      })

      expect(gitIndex.fetchFiles).toHaveBeenCalledTimes(2)
      // Second call should use the skills/-prefixed source
      const secondCallArg = vi.mocked(gitIndex.fetchFiles).mock.calls[1]![0] as ResolvedRef
      expect(secondCallArg.source.path).toBe('skills/my-skill')
      // Install should succeed
      expect(result).toBeDefined()
      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      expect(lockfileModule.writeLockfile).toHaveBeenCalledTimes(1)
    })

    it('does not retry with skills/ prefix when direct path returns files', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      // fetchFiles should only be called once — no retry needed
      expect(gitIndex.fetchFiles).toHaveBeenCalledTimes(1)
      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
    })

    it('throws AgentverError when both direct and skills/-prefixed paths return no files', async () => {
      const gitSource = createGitSource({ path: 'nonexistent-skill' })
      const resolved: ResolvedRef = { source: gitSource, commitSha: RESOLVED_SHA }
      const emptyResult: FetchResult = { files: [], commitSha: RESOLVED_SHA, source: gitSource }

      vi.mocked(gitIndex.parseGitSource).mockReturnValue(gitSource)
      vi.mocked(gitIndex.resolveRef).mockResolvedValue(resolved)
      // Both calls return empty
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue(emptyResult)
      vi.mocked(configModule.readConfig).mockReturnValue({})
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
      ])

      await expect(
        installPackage('github.com/test-org/test-repo/nonexistent-skill@main', {
          agent: 'claude-code',
        })
      ).rejects.toThrow(AgentverError)

      // Should have tried both the direct path and the skills/ prefix
      expect(gitIndex.fetchFiles).toHaveBeenCalledTimes(2)
      expect(process.exit).not.toHaveBeenCalled()
      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })

    it('does not retry when source has no path (repo root)', async () => {
      const gitSource = createGitSource({ path: '' })
      const resolved: ResolvedRef = { source: gitSource, commitSha: RESOLVED_SHA }
      const emptyResult: FetchResult = { files: [], commitSha: RESOLVED_SHA, source: gitSource }

      vi.mocked(gitIndex.parseGitSource).mockReturnValue(gitSource)
      vi.mocked(gitIndex.resolveRef).mockResolvedValue(resolved)
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue(emptyResult)
      vi.mocked(configModule.readConfig).mockReturnValue({})
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
      ])

      await expect(
        installPackage('github.com/test-org/test-repo@main', { agent: 'claude-code' })
      ).rejects.toThrow(AgentverError)

      // Should NOT retry — no path means no skills/ prefix to try
      expect(gitIndex.fetchFiles).toHaveBeenCalledTimes(1)
      expect(process.exit).not.toHaveBeenCalled()
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
        { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
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

    it('throws with NOT_FOUND when skill is not in the well-known index', async () => {
      setupWellKnownMocks()
      vi.mocked(wellknownModule.parseWellKnownSource).mockReturnValue({
        baseUrl: 'https://skills.example.com',
        skillName: 'nonexistent-skill',
      })

      try {
        await installPackage('https://skills.example.com/nonexistent-skill', {
          agent: 'claude-code',
        })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('NOT_FOUND')
      }

      expect(process.exit).not.toHaveBeenCalled()
      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })

    it('throws with NOT_FOUND containing skill name when not found in JSON mode', async () => {
      setupWellKnownMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(wellknownModule.parseWellKnownSource).mockReturnValue({
        baseUrl: 'https://skills.example.com',
        skillName: 'nonexistent-skill',
      })

      try {
        await installPackage('https://skills.example.com/nonexistent-skill', {
          agent: 'claude-code',
        })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('NOT_FOUND')
        expect((error as AgentverError).message).toContain('nonexistent-skill')
      }
    })

    it('throws with AMBIGUOUS_SKILL when multiple skills found and no specifier', async () => {
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

      try {
        await installPackage('https://skills.example.com', { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('AMBIGUOUS_SKILL')
      }

      expect(process.exit).not.toHaveBeenCalled()
    })

    it('throws AMBIGUOUS_SKILL containing skill names when multiple skills and JSON mode', async () => {
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

      try {
        await installPackage('https://skills.example.com', { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('AMBIGUOUS_SKILL')
        expect((error as AgentverError).message).toContain('skill-a')
      }
    })

    it('throws with NO_FILES when well-known fetch returns empty files', async () => {
      setupWellKnownMocks()
      vi.mocked(wellknownModule.fetchWellKnownSkill).mockResolvedValue({
        name: 'test-skill',
        description: 'A test',
        files: [],
        sourceUrl: 'https://skills.example.com/.well-known/skills/test-skill',
        hostname: 'skills.example.com',
      })

      try {
        await installPackage('https://skills.example.com', { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('NO_FILES')
      }

      expect(process.exit).not.toHaveBeenCalled()
    })

    it('throws NO_FILES with skill name when no files and JSON mode', async () => {
      setupWellKnownMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(wellknownModule.fetchWellKnownSkill).mockResolvedValue({
        name: 'test-skill',
        description: 'A test',
        files: [],
        sourceUrl: 'https://skills.example.com/.well-known/skills/test-skill',
        hostname: 'skills.example.com',
      })

      try {
        await installPackage('https://skills.example.com', { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('NO_FILES')
        expect((error as AgentverError).message).toContain('test-skill')
      }
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

    it('catches unexpected errors and throws with INSTALL_FAILED in JSON mode', async () => {
      vi.mocked(wellknownModule.looksLikeWellKnownUrl).mockReturnValue(true)
      vi.mocked(wellknownModule.parseWellKnownSource).mockImplementation(() => {
        throw new Error('Unexpected parse failure')
      })
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      try {
        await installPackage('https://skills.example.com', { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('INSTALL_FAILED')
        expect((error as AgentverError).message).toContain('Unexpected parse failure')
      }
    })

    it('catches unexpected errors and throws in non-JSON mode', async () => {
      vi.mocked(wellknownModule.looksLikeWellKnownUrl).mockReturnValue(true)
      vi.mocked(wellknownModule.parseWellKnownSource).mockImplementation(() => {
        throw new Error('Unexpected parse failure')
      })

      await expect(
        installPackage('https://skills.example.com', { agent: 'claude-code' })
      ).rejects.toThrow(AgentverError)

      expect(process.exit).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Short name platform resolution (org/package format)
  // -------------------------------------------------------------------------

  describe('short name platform resolution', () => {
    it('resolves org/package via platform when platformUrl is configured (git-backed)', async () => {
      setupHappyPathMocks()
      vi.mocked(configModule.readConfig).mockReturnValue({
        platformUrl: 'https://app.agentver.com',
      })
      vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'test-token' })

      // Platform returns a git-backed package — installFromPlatform delegates to installPackage
      // with the full git URL, which then goes through the git flow
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            gitUri: 'github.com/resolved-org/resolved-repo',
            gitPath: 'skills/resolved-skill',
            gitRef: 'main',
            source: 'git',
          }),
      })
      globalThis.fetch = mockFetch

      const resolvedGitSource = createGitSource({
        host: 'github.com',
        owner: 'resolved-org',
        repo: 'resolved-repo',
        path: 'skills/resolved-skill',
        ref: 'main',
      })
      vi.mocked(gitIndex.parseGitSource).mockReturnValue(resolvedGitSource)

      const result = await installPackage('my-org/my-skill', { agent: 'claude-code' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/resolve?name=my-org%2Fmy-skill'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        })
      )
      expect(result).toBeDefined()
      expect(result!.name).toBe('resolved-skill')
    })

    it('installs directly from platform when source is platform-hosted', async () => {
      setupHappyPathMocks()
      vi.mocked(configModule.readConfig).mockReturnValue({
        platformUrl: 'https://app.agentver.com',
      })
      vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'test-token' })

      // Platform returns a platform-hosted package with files
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            gitUri: 'agentver://my-org/skills',
            gitPath: 'my-skill',
            gitRef: 'main',
            source: 'platform',
            files: [{ path: 'SKILL.md', content: '# My Skill\nSome content' }],
          }),
      })
      globalThis.fetch = mockFetch

      const result = await installPackage('my-org/my-skill', { agent: 'claude-code' })

      expect(result).toBeDefined()
      expect(result!.name).toBe('my-skill')
      // Should NOT call parseGitSource — files come directly from platform
      expect(gitIndex.parseGitSource).not.toHaveBeenCalled()
    })

    it('passes user-specified ref through to platform resolution', async () => {
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
            source: 'git',
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

      await installPackage('my-org/my-skill@v2.0', { agent: 'claude-code' })

      // The recursive installPackage call should receive the full git URL with user ref
      expect(gitIndex.parseGitSource).toHaveBeenCalledWith(expect.stringContaining('@v2.0'))
    })

    it('throws VALIDATION_ERROR when short name used without platformUrl', async () => {
      setupHappyPathMocks()
      vi.mocked(configModule.readConfig).mockReturnValue({})

      try {
        await installPackage('my-org/my-skill', { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('VALIDATION_ERROR')
      }

      expect(process.exit).not.toHaveBeenCalled()
    })

    it('throws VALIDATION_ERROR containing URL hint when no platformUrl in JSON mode', async () => {
      setupHappyPathMocks()
      vi.mocked(configModule.readConfig).mockReturnValue({})
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      try {
        await installPackage('my-org/my-skill', { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('VALIDATION_ERROR')
        expect((error as AgentverError).message).toContain("doesn't look like a Git URL")
      }
    })

    it('throws VALIDATION_ERROR for single-segment package names', async () => {
      setupHappyPathMocks()
      vi.mocked(configModule.readConfig).mockReturnValue({
        platformUrl: 'https://app.agentver.com',
      })

      try {
        await installPackage('my-skill', { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('VALIDATION_ERROR')
      }

      expect(process.exit).not.toHaveBeenCalled()
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

    it('prompts user in non-JSON mode and throws CANCELLED on decline', async () => {
      setupHappyPathMocks()
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('WARN'))
      vi.mocked(promptsDefault).mockResolvedValue({ proceed: false })

      try {
        await installPackage(TEST_SOURCE, { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('CANCELLED')
      }

      expect(promptsDefault).toHaveBeenCalled()
      expect(process.exit).not.toHaveBeenCalled()
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
      vi.mocked(agentDefs.translateConfig).mockReturnValue([
        {
          agentId: 'claude-code',
          filePath: 'CLAUDE.md',
          content: '# My Config\n\nRules for the agent.\n',
        },
      ])

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      expect(nodeFs.writeFileSync).toHaveBeenCalled()
      const writeCalls = vi.mocked(nodeFs.writeFileSync).mock.calls
      const writtenPaths = writeCalls.map((c) => String(c[0]))
      expect(writtenPaths.some((p) => p.includes('CLAUDE.md'))).toBe(true)
    })

    it('does not write config file in dry-run mode for AGENT_CONFIG', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })

      const result = await installPackage(TEST_SOURCE, { agent: 'claude-code', dryRun: true })

      // In dry-run mode, writeFileSync should NOT be called — returns before translateConfig
      expect(nodeFs.writeFileSync).not.toHaveBeenCalled()
      expect(result).toBeDefined()
    })

    it('skips writing when translateConfig returns empty array', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })
      vi.mocked(agentDefs.translateConfig).mockReturnValue([])

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      expect(nodeFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('writes YAML-wrapped content for goose', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })
      const yamlContent = 'instructions: "# My Config\\n\\nRules for the agent.\\n"\n'
      vi.mocked(agentDefs.translateConfig).mockReturnValue([
        {
          agentId: 'goose',
          filePath: '.goose/config.yaml',
          content: yamlContent,
        },
      ])

      await installPackage(TEST_SOURCE, { agent: 'goose' })

      const writeCalls = vi.mocked(nodeFs.writeFileSync).mock.calls
      expect(writeCalls).toHaveLength(1)
      expect(String(writeCalls[0]![0])).toContain('.goose/config.yaml')
      expect(writeCalls[0]![1]).toBe(yamlContent)
    })

    it('writes read redirect for aider', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })
      const redirectContent = 'read:\n  - AGENTS.md\n'
      vi.mocked(agentDefs.translateConfig).mockReturnValue([
        {
          agentId: 'aider',
          filePath: '.aider.conf.yml',
          content: redirectContent,
        },
      ])

      await installPackage(TEST_SOURCE, { agent: 'aider' })

      const writeCalls = vi.mocked(nodeFs.writeFileSync).mock.calls
      expect(writeCalls).toHaveLength(1)
      expect(String(writeCalls[0]![0])).toContain('.aider.conf.yml')
      expect(writeCalls[0]![1]).toBe(redirectContent)
    })

    it('writes to dynamic path for roo', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })
      vi.mocked(agentDefs.translateConfig).mockReturnValue([
        {
          agentId: 'roo',
          filePath: `.roo/rules/${DERIVED_NAME}.md`,
          content: '# My Config\n\nRules for the agent.\n',
        },
      ])

      await installPackage(TEST_SOURCE, { agent: 'roo' })

      const writeCalls = vi.mocked(nodeFs.writeFileSync).mock.calls
      expect(writeCalls).toHaveLength(1)
      expect(String(writeCalls[0]![0])).toContain(`.roo/rules/${DERIVED_NAME}.md`)
    })

    it('writes to dynamic path for cline', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })
      vi.mocked(agentDefs.translateConfig).mockReturnValue([
        {
          agentId: 'cline',
          filePath: `.clinerules/${DERIVED_NAME}.md`,
          content: '# My Config\n\nRules for the agent.\n',
        },
      ])

      await installPackage(TEST_SOURCE, { agent: 'cline' })

      const writeCalls = vi.mocked(nodeFs.writeFileSync).mock.calls
      expect(writeCalls).toHaveLength(1)
      expect(String(writeCalls[0]![0])).toContain(`.clinerules/${DERIVED_NAME}.md`)
    })

    it('passes raw markdown for claude-code (passthrough)', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      const rawContent = '# My Config\n\nRules for the agent.\n'
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })
      vi.mocked(agentDefs.translateConfig).mockReturnValue([
        {
          agentId: 'claude-code',
          filePath: 'CLAUDE.md',
          content: rawContent,
        },
      ])

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      const writeCalls = vi.mocked(nodeFs.writeFileSync).mock.calls
      expect(writeCalls).toHaveLength(1)
      expect(writeCalls[0]![1]).toBe(rawContent)
    })

    it('composes translated content into existing composed config', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      const newContent = '# My Config\n\nRules for the agent.\n'
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })
      vi.mocked(agentDefs.translateConfig).mockReturnValue([
        {
          agentId: 'claude-code',
          filePath: 'CLAUDE.md',
          content: newContent,
        },
      ])

      // Simulate an existing composed config file on disk
      vi.mocked(nodeFs.existsSync).mockReturnValue(true)
      const existingComposed = '## From: existing-pkg\n\nExisting rules.\n'
      vi.mocked(nodeFs.readFileSync).mockReturnValue(existingComposed)
      vi.mocked(agentDefs.isComposedConfig).mockReturnValue(true)
      vi.mocked(agentDefs.parseComposedSections).mockReturnValue([
        { packageName: 'existing-pkg', content: 'Existing rules.\n' },
      ])
      const composedOutput =
        '## From: existing-pkg\n\nExisting rules.\n\n## From: test-skill\n\n# My Config\n\nRules for the agent.\n'
      vi.mocked(agentDefs.composeConfigs).mockReturnValue({
        content: composedOutput,
        sources: ['existing-pkg', DERIVED_NAME],
      })

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      // composeConfigs should be called with existing + new translated content
      expect(agentDefs.composeConfigs).toHaveBeenCalledWith([
        { packageName: 'existing-pkg', content: 'Existing rules.\n', order: 0 },
        { packageName: DERIVED_NAME, content: newContent, order: 1 },
      ])

      const writeCalls = vi.mocked(nodeFs.writeFileSync).mock.calls
      expect(writeCalls).toHaveLength(1)
      expect(writeCalls[0]![1]).toBe(composedOutput)
    })

    it('updates existing section when reinstalling into a composed config', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      const updatedContent = '# Updated Config\n\nNew rules.\n'
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })
      vi.mocked(agentDefs.translateConfig).mockReturnValue([
        {
          agentId: 'claude-code',
          filePath: 'CLAUDE.md',
          content: updatedContent,
        },
      ])

      // Simulate an existing composed config that already contains this package
      vi.mocked(nodeFs.existsSync).mockReturnValue(true)
      const existingComposed =
        '## From: test-skill\n\nOld rules.\n\n## From: other-pkg\n\nOther rules.\n'
      vi.mocked(nodeFs.readFileSync).mockReturnValue(existingComposed)
      vi.mocked(agentDefs.isComposedConfig).mockReturnValue(true)
      vi.mocked(agentDefs.parseComposedSections).mockReturnValue([
        { packageName: DERIVED_NAME, content: 'Old rules.\n' },
        { packageName: 'other-pkg', content: 'Other rules.\n' },
      ])
      const recomposedOutput =
        '## From: test-skill\n\n# Updated Config\n\nNew rules.\n\n## From: other-pkg\n\nOther rules.\n'
      vi.mocked(agentDefs.composeConfigs).mockReturnValue({
        content: recomposedOutput,
        sources: [DERIVED_NAME, 'other-pkg'],
      })

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      // composeConfigs should be called with updated content for this package, preserving others
      expect(agentDefs.composeConfigs).toHaveBeenCalledWith([
        { packageName: DERIVED_NAME, content: updatedContent, order: 0 },
        { packageName: 'other-pkg', content: 'Other rules.\n', order: 1 },
      ])

      const writeCalls = vi.mocked(nodeFs.writeFileSync).mock.calls
      expect(writeCalls).toHaveLength(1)
      expect(writeCalls[0]![1]).toBe(recomposedOutput)
    })

    it('resolves config path under homedir for global installs', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })
      vi.mocked(agentDefs.translateConfig).mockReturnValue([
        {
          agentId: 'goose',
          filePath: '.goose/config.yaml',
          content: 'instructions: "rules"\n',
        },
      ])

      await installPackage(TEST_SOURCE, { agent: 'goose', global: true })

      const writeCalls = vi.mocked(nodeFs.writeFileSync).mock.calls
      expect(writeCalls).toHaveLength(1)
      // Global path should be resolved under homedir, not project root
      expect(String(writeCalls[0]![0])).toBe('/mock-home/.goose/config.yaml')
    })

    it('rejects path traversal in translateConfig filePath', async () => {
      setupHappyPathMocks()
      const configFiles = createAgentConfigFiles()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: configFiles,
        commitSha: RESOLVED_SHA,
        source: createGitSource(),
      })
      vi.mocked(agentDefs.translateConfig).mockReturnValue([
        {
          agentId: 'claude-code',
          filePath: '../../../.ssh/config',
          content: 'malicious content',
        },
      ])

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      const writeCalls = vi.mocked(nodeFs.writeFileSync).mock.calls
      const writtenPaths = writeCalls.map((c) => String(c[0]))
      expect(writtenPaths.some((p) => p.includes('.ssh/config'))).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // --no-detect without --agent
  // -------------------------------------------------------------------------

  describe('--no-detect without --agent', () => {
    it('throws VALIDATION_ERROR when --no-detect used without --agent', async () => {
      setupHappyPathMocks()

      try {
        await installPackage(TEST_SOURCE, { detect: false })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('VALIDATION_ERROR')
      }

      expect(process.exit).not.toHaveBeenCalled()
      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })

    it('throws VALIDATION_ERROR mentioning --agent in JSON mode when --no-detect used without --agent', async () => {
      setupHappyPathMocks()
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      try {
        await installPackage(TEST_SOURCE, { detect: false })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('VALIDATION_ERROR')
        expect((error as AgentverError).message).toContain('--agent')
      }
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

      try {
        await installPackage('https://skills.example.com', { detect: false })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('VALIDATION_ERROR')
      }

      expect(process.exit).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // parseAgentverUri — pure function unit tests
  // -------------------------------------------------------------------------

  describe('parseAgentverUri', () => {
    it('parses a full URI with org, deep path, and ref', () => {
      const result = parseAgentverUri(
        'agentver://lleverage/skills/google-search-console/SKILL.md@main'
      )
      expect(result).toEqual({
        org: 'lleverage',
        path: 'skills/google-search-console/SKILL.md',
        ref: 'main',
      })
    })

    it('parses a URI with org, path, and a version ref', () => {
      const result = parseAgentverUri('agentver://lleverage/skills/google-search-console@v1.0')
      expect(result).toEqual({
        org: 'lleverage',
        path: 'skills/google-search-console',
        ref: 'v1.0',
      })
    })

    it('parses a URI with org and ref but no path', () => {
      const result = parseAgentverUri('agentver://myorg@main')
      expect(result).toEqual({
        org: 'myorg',
        path: '',
        ref: 'main',
      })
    })

    it('parses a URI with org and single path segment but no ref', () => {
      const result = parseAgentverUri('agentver://myorg/single-skill')
      expect(result).toEqual({
        org: 'myorg',
        path: 'single-skill',
        ref: '',
      })
    })

    it('returns null for a git URL', () => {
      expect(parseAgentverUri('github.com/org/repo')).toBeNull()
    })

    it('returns null for a plain skill name', () => {
      expect(parseAgentverUri('my-skill')).toBeNull()
    })

    it('returns null for bare protocol with no org', () => {
      expect(parseAgentverUri('agentver://')).toBeNull()
    })

    it('treats agentver://@main as org "@main" since @ at position 0 is not a ref separator', () => {
      // The parser only splits on @ when atIndex > 0, so the leading @ is part of the path
      const result = parseAgentverUri('agentver://@main')
      expect(result).toEqual({ org: '@main', path: '', ref: '' })
    })

    it('returns null for a well-known HTTPS URL', () => {
      expect(parseAgentverUri('https://skills.example.com/my-skill')).toBeNull()
    })

    it('returns null for an empty string', () => {
      expect(parseAgentverUri('')).toBeNull()
    })

    it('uses lastIndexOf for @ so paths with @ in segments are handled', () => {
      const result = parseAgentverUri('agentver://org/path@special@v2')
      expect(result).toEqual({
        org: 'org',
        path: 'path@special',
        ref: 'v2',
      })
    })
  })

  // -------------------------------------------------------------------------
  // agentver:// URI install (installFromPlatform flow)
  // -------------------------------------------------------------------------

  describe('agentver:// URI install via platform', () => {
    const PLATFORM_URL = 'https://app.agentver.com'
    let originalFetch: typeof globalThis.fetch

    beforeEach(() => {
      originalFetch = globalThis.fetch
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    function setupPlatformMocks(
      resolveResponse: Record<string, unknown>,
      opts?: { platformUrl?: string | undefined; token?: string }
    ) {
      const { platformUrl = PLATFORM_URL, token = 'test-token' } = opts ?? {}

      vi.mocked(configModule.readConfig).mockReturnValue({
        platformUrl: platformUrl ?? undefined,
      })
      vi.mocked(authModule.getCredentials).mockResolvedValue(
        token ? { token } : { token: undefined, apiKey: undefined }
      )

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(resolveResponse),
      })
      globalThis.fetch = mockFetch

      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue(INTEGRITY_HASH)
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())
      vi.mocked(canonicalModule.getCanonicalSkillPath).mockReturnValue(
        '/project/.agents/skills/google-search-console'
      )
      vi.mocked(agentDefs.detectInstalledAgents).mockReturnValue([
        { id: 'claude-code', name: 'Claude Code', configPath: '/project/.claude' },
      ])

      return { mockFetch }
    }

    it('installs platform-hosted package directly from response files', async () => {
      const platformFiles = [
        { path: 'SKILL.md', content: '# Google Search Console\n\nSkill content.' },
        { path: 'references/api.md', content: '# API Reference\n\nAPI docs.' },
      ]
      setupPlatformMocks({
        gitUri: 'github.com/lleverage/skills',
        gitPath: 'google-search-console',
        gitRef: 'main',
        source: 'platform',
        files: platformFiles,
      })

      const result = await installPackage(
        'agentver://lleverage/skills/google-search-console@main',
        { agent: 'claude-code' }
      )

      expect(result).toBeDefined()
      expect(result!.name).toBe('google-search-console')
      expect(result!.agents).toEqual(['claude-code'])
      // Should write manifest and lockfile
      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      expect(lockfileModule.writeLockfile).toHaveBeenCalledTimes(1)
    })

    it('delegates to git install flow when platform resolves a git-backed package', async () => {
      const { mockFetch } = setupPlatformMocks({
        gitUri: 'github.com/lleverage/skills-repo',
        gitPath: 'google-search-console',
        gitRef: 'main',
        source: 'git',
      })

      // Set up git mocks for the delegated flow
      const gitSource = createGitSource({
        host: 'github.com',
        owner: 'lleverage',
        repo: 'skills-repo',
        path: 'google-search-console',
        ref: 'main',
      })
      const files = createFetchedFiles(2)
      const resolved: ResolvedRef = { source: gitSource, commitSha: RESOLVED_SHA }
      const fetchResult: FetchResult = { files, commitSha: RESOLVED_SHA, source: gitSource }

      vi.mocked(gitIndex.parseGitSource).mockReturnValue(gitSource)
      vi.mocked(gitIndex.resolveRef).mockResolvedValue(resolved)
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue(fetchResult)

      const result = await installPackage(
        'agentver://lleverage/skills/google-search-console@main',
        { agent: 'claude-code' }
      )

      // The platform fetch should have been called first
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/resolve?name='),
        expect.any(Object)
      )
      // Then the git flow should have been followed
      expect(gitIndex.parseGitSource).toHaveBeenCalled()
      expect(result).toBeDefined()
    })

    it('throws VALIDATION_ERROR when agentver:// URI is used without platformUrl configured', async () => {
      vi.mocked(configModule.readConfig).mockReturnValue({})

      try {
        await installPackage('agentver://lleverage/skills/google-search-console@main', {
          agent: 'claude-code',
        })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('VALIDATION_ERROR')
      }

      expect(process.exit).not.toHaveBeenCalled()
    })

    it('throws VALIDATION_ERROR with platform hint when agentver:// URI used without platformUrl in JSON mode', async () => {
      vi.mocked(configModule.readConfig).mockReturnValue({})
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      try {
        await installPackage('agentver://lleverage/skills/google-search-console@main', {
          agent: 'claude-code',
        })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('VALIDATION_ERROR')
        expect((error as AgentverError).message).toContain('platform connection')
      }
    })

    it('uses the ref from the URI when the platform also provides a gitRef', async () => {
      setupPlatformMocks({
        gitUri: 'github.com/lleverage/skills-repo',
        gitPath: 'google-search-console',
        gitRef: 'main',
        source: 'git',
      })

      const gitSource = createGitSource({
        host: 'github.com',
        owner: 'lleverage',
        repo: 'skills-repo',
        path: 'google-search-console',
        ref: 'v2.0',
      })
      vi.mocked(gitIndex.parseGitSource).mockReturnValue(gitSource)
      vi.mocked(gitIndex.resolveRef).mockResolvedValue({
        source: gitSource,
        commitSha: RESOLVED_SHA,
      })
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: createFetchedFiles(2),
        commitSha: RESOLVED_SHA,
        source: gitSource,
      })

      await installPackage('agentver://lleverage/skills/google-search-console@v2.0', {
        agent: 'claude-code',
      })

      // The delegated call to installPackage should use the URI ref (@v2.0), not the platform gitRef
      expect(gitIndex.parseGitSource).toHaveBeenCalledWith(expect.stringContaining('@v2.0'))
    })

    it('falls back to platform gitRef when URI has no ref', async () => {
      setupPlatformMocks({
        gitUri: 'github.com/lleverage/skills-repo',
        gitPath: 'google-search-console',
        gitRef: 'release-1.5',
        source: 'git',
      })

      const gitSource = createGitSource({
        host: 'github.com',
        owner: 'lleverage',
        repo: 'skills-repo',
        path: 'google-search-console',
        ref: 'release-1.5',
      })
      vi.mocked(gitIndex.parseGitSource).mockReturnValue(gitSource)
      vi.mocked(gitIndex.resolveRef).mockResolvedValue({
        source: gitSource,
        commitSha: RESOLVED_SHA,
      })
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: createFetchedFiles(2),
        commitSha: RESOLVED_SHA,
        source: gitSource,
      })

      await installPackage('agentver://lleverage/skills/google-search-console', {
        agent: 'claude-code',
      })

      // Should use the platform-provided gitRef since no @ref in the URI
      expect(gitIndex.parseGitSource).toHaveBeenCalledWith(expect.stringContaining('@release-1.5'))
    })

    it('sends authorisation header with bearer token to the platform', async () => {
      const { mockFetch } = setupPlatformMocks(
        {
          gitUri: 'github.com/lleverage/skills',
          gitPath: 'gsc',
          gitRef: 'main',
          source: 'platform',
          files: [{ path: 'SKILL.md', content: '# Skill' }],
        },
        { token: 'my-secret-token' }
      )

      await installPackage('agentver://lleverage/gsc@main', { agent: 'claude-code' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer my-secret-token' }),
        })
      )
    })

    it('skips writing manifest and lockfile in dry-run mode for platform-hosted packages', async () => {
      setupPlatformMocks({
        gitUri: 'github.com/lleverage/skills',
        gitPath: 'gsc',
        gitRef: 'main',
        source: 'platform',
        files: [{ path: 'SKILL.md', content: '# Skill content' }],
      })

      const result = await installPackage('agentver://lleverage/gsc@main', {
        agent: 'claude-code',
        dryRun: true,
      })

      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
      expect(lockfileModule.writeLockfile).not.toHaveBeenCalled()
      expect(result).toBeDefined()
      expect(result!.name).toBe('gsc')
    })

    it('runs security scan on platform-hosted files when skipAudit is not set', async () => {
      setupPlatformMocks({
        gitUri: 'github.com/lleverage/skills',
        gitPath: 'gsc',
        gitRef: 'main',
        source: 'platform',
        files: [{ path: 'SKILL.md', content: '# Skill content' }],
      })

      await installPackage('agentver://lleverage/gsc@main', { agent: 'claude-code' })

      expect(securityModule.scanFiles).toHaveBeenCalledTimes(1)
    })

    it('skips security scan on platform-hosted files when skipAudit is true', async () => {
      setupPlatformMocks({
        gitUri: 'github.com/lleverage/skills',
        gitPath: 'gsc',
        gitRef: 'main',
        source: 'platform',
        files: [{ path: 'SKILL.md', content: '# Skill content' }],
      })

      await installPackage('agentver://lleverage/gsc@main', {
        agent: 'claude-code',
        skipAudit: true,
      })

      expect(securityModule.scanFiles).not.toHaveBeenCalled()
    })

    it('throws AgentverError when platform resolve returns an HTTP error', async () => {
      vi.mocked(configModule.readConfig).mockReturnValue({ platformUrl: PLATFORM_URL })
      vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'test-token' })

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      })

      try {
        await installPackage('agentver://nonexistent/package@main', { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('NOT_FOUND')
      }

      expect(process.exit).not.toHaveBeenCalled()
    })

    it('throws with SECURITY_BLOCK when platform-hosted scan returns BLOCK', async () => {
      setupPlatformMocks({
        gitUri: 'github.com/lleverage/skills',
        gitPath: 'gsc',
        gitRef: 'main',
        source: 'platform',
        files: [{ path: 'SKILL.md', content: '# Skill content' }],
      })
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('BLOCK'))

      try {
        await installPackage('agentver://lleverage/gsc@main', { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('SECURITY_BLOCK')
      }

      expect(process.exit).not.toHaveBeenCalled()
    })

    it('throws with CANCELLED when user declines platform-hosted security warning', async () => {
      setupPlatformMocks({
        gitUri: 'github.com/lleverage/skills',
        gitPath: 'gsc',
        gitRef: 'main',
        source: 'platform',
        files: [{ path: 'SKILL.md', content: '# Skill content' }],
      })
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('WARN'))
      vi.mocked(promptsDefault).mockResolvedValue({ proceed: false })

      try {
        await installPackage('agentver://lleverage/gsc@main', { agent: 'claude-code' })
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AgentverError)
        expect((error as AgentverError).code).toBe('CANCELLED')
      }

      expect(process.exit).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Global scope support
  // -------------------------------------------------------------------------

  describe('--global scope', () => {
    it('passes global scope to readManifest and writeManifest', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { global: true, agent: 'claude-code' })

      expect(manifestModule.readManifest).toHaveBeenCalledWith('/project', 'global')
      expect(manifestModule.writeManifest).toHaveBeenCalledWith(
        '/project',
        expect.objectContaining({
          version: 2,
          packages: expect.objectContaining({
            [DERIVED_NAME]: expect.any(Object),
          }),
        }),
        'global'
      )
    })

    it('passes global scope to readLockfile and writeLockfile', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { global: true, agent: 'claude-code' })

      expect(lockfileModule.readLockfile).toHaveBeenCalledWith('/project', 'global')
      expect(lockfileModule.writeLockfile).toHaveBeenCalledWith(
        '/project',
        expect.objectContaining({
          version: 2,
          packages: expect.objectContaining({
            [DERIVED_NAME]: expect.any(Object),
          }),
        }),
        'global'
      )
    })

    it('uses project scope by default when --global is not set', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      expect(manifestModule.readManifest).toHaveBeenCalledWith('/project', 'project')
      expect(manifestModule.writeManifest).toHaveBeenCalledWith(
        '/project',
        expect.any(Object),
        'project'
      )
      expect(lockfileModule.readLockfile).toHaveBeenCalledWith('/project', 'project')
      expect(lockfileModule.writeLockfile).toHaveBeenCalledWith(
        '/project',
        expect.any(Object),
        'project'
      )
    })

    it('global install only interacts with global scope for manifest/lockfile', async () => {
      setupHappyPathMocks()

      await installPackage(TEST_SOURCE, { global: true, agent: 'claude-code' })

      for (const call of vi.mocked(manifestModule.readManifest).mock.calls) {
        expect(call[1]).toBe('global')
      }
      for (const call of vi.mocked(manifestModule.writeManifest).mock.calls) {
        expect(call[2]).toBe('global')
      }
      for (const call of vi.mocked(lockfileModule.readLockfile).mock.calls) {
        expect(call[1]).toBe('global')
      }
      for (const call of vi.mocked(lockfileModule.writeLockfile).mock.calls) {
        expect(call[2]).toBe('global')
      }
    })
  })

  // -------------------------------------------------------------------------
  // registerInstallCommand — top-level catch
  // -------------------------------------------------------------------------

  describe('registerInstallCommand top-level catch', () => {
    function createProgram(): Command {
      const program = new Command()
      program.exitOverride()
      registerInstallCommand(program)
      return program
    }

    it('calls process.exit(1) when installPackage throws an error', async () => {
      // Set up mocks that cause installPackage to fail (no git source parse)
      vi.mocked(gitIndex.parseGitSource).mockImplementation(() => {
        throw new Error('invalid source')
      })
      vi.mocked(configModule.readConfig).mockReturnValue({})
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)
      vi.mocked(wellknownModule.looksLikeWellKnownUrl).mockReturnValue(false)

      // process.exit throws ExitError in our test setup, so catch it
      const program = createProgram()
      try {
        await program.parseAsync(['node', 'agentver', 'install', 'bad-source.com/foo'])
        expect.unreachable('Should have called process.exit')
      } catch {
        // ExitError from process.exit mock
      }

      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('calls process.exit(0) when installPackage throws CANCELLED', async () => {
      setupHappyPathMocks()
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('WARN'))
      vi.mocked(promptsDefault).mockResolvedValue({ proceed: false })

      const program = createProgram()
      try {
        await program.parseAsync(['node', 'agentver', 'install', TEST_SOURCE])
        expect.unreachable('Should have called process.exit')
      } catch {
        // ExitError from process.exit mock
      }

      expect(process.exit).toHaveBeenCalledWith(0)
    })

    it('outputs JSON error when in JSON mode and installPackage throws', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(gitIndex.parseGitSource).mockImplementation(() => {
        throw new AgentverError('VALIDATION_ERROR', 'test error')
      })
      vi.mocked(configModule.readConfig).mockReturnValue({})
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)
      vi.mocked(wellknownModule.looksLikeWellKnownUrl).mockReturnValue(false)

      const program = createProgram()
      try {
        await program.parseAsync(['node', 'agentver', 'install', 'github.com/org/repo'])
        expect.unreachable('Should have called process.exit')
      } catch {
        // ExitError from process.exit mock
      }

      expect(outputModule.outputError).toHaveBeenCalledWith('VALIDATION_ERROR', 'test error')
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // AGENT package type (--type agent)
  // -------------------------------------------------------------------------

  describe('AGENT package type install (--type agent)', () => {
    function setupAgentTypeMocks() {
      const mocks = setupHappyPathMocks()

      // Override files to contain an .md file (the single-file package content)
      const agentContent = '# My Agent\n\nDoes agent things.\n'
      const files: FetchedFile[] = [
        { path: 'AGENT.md', content: agentContent, size: agentContent.length },
      ]
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files,
        commitSha: RESOLVED_SHA,
        source: mocks.gitSource,
      })

      // Mock getAgentPlacementPath to return a project-relative path
      vi.mocked(agentDefs.getAgentPlacementPath).mockReturnValue('.claude/agents/AGENT.md')

      return { ...mocks, files }
    }

    it('writes the .md file via writeFileSync at the agent placement path', async () => {
      setupAgentTypeMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', type: 'agent' })

      expect(nodeFs.writeFileSync).toHaveBeenCalledWith(
        '/project/.claude/agents/AGENT.md',
        '# My Agent\n\nDoes agent things.\n',
        'utf-8'
      )
    })

    it('stores packageType AGENT and entryFile in manifest', async () => {
      setupAgentTypeMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', type: 'agent' })

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      const pkg = manifest.packages[DERIVED_NAME]!
      expect(pkg.packageType).toBe('AGENT')
      expect(pkg.entryFile).toBe('AGENT.md')
    })

    it('does not create canonical symlinks for agent-type packages', async () => {
      setupAgentTypeMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', type: 'agent' })

      expect(canonicalModule.createAgentSymlinks).not.toHaveBeenCalled()
    })

    it('calls getAgentPlacementPath with the correct agentId and fileName', async () => {
      setupAgentTypeMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', type: 'agent' })

      expect(agentDefs.getAgentPlacementPath).toHaveBeenCalledWith(
        'claude-code',
        'AGENT.md',
        'project'
      )
    })

    it('creates parent directory if it does not exist', async () => {
      setupAgentTypeMocks()
      vi.mocked(nodeFs.existsSync).mockReturnValue(false)

      await installPackage(TEST_SOURCE, { agent: 'claude-code', type: 'agent' })

      expect(nodeFs.mkdirSync).toHaveBeenCalledWith('/project/.claude/agents', { recursive: true })
    })

    it('does not write files in dry-run mode', async () => {
      setupAgentTypeMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', type: 'agent', dryRun: true })

      expect(nodeFs.writeFileSync).not.toHaveBeenCalled()
      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // COMMAND package type (--type command)
  // -------------------------------------------------------------------------

  describe('COMMAND package type install (--type command)', () => {
    function setupCommandTypeMocks() {
      const mocks = setupHappyPathMocks()

      const commandContent = '# My Command\n\nDoes command things.\n'
      const files: FetchedFile[] = [
        { path: 'COMMAND.md', content: commandContent, size: commandContent.length },
      ]
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files,
        commitSha: RESOLVED_SHA,
        source: mocks.gitSource,
      })

      vi.mocked(agentDefs.getCommandPlacementPath).mockReturnValue('.claude/commands/COMMAND.md')

      return { ...mocks, files }
    }

    it('writes the .md file via writeFileSync at the command placement path', async () => {
      setupCommandTypeMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', type: 'command' })

      expect(nodeFs.writeFileSync).toHaveBeenCalledWith(
        '/project/.claude/commands/COMMAND.md',
        '# My Command\n\nDoes command things.\n',
        'utf-8'
      )
    })

    it('stores packageType COMMAND and entryFile in manifest', async () => {
      setupCommandTypeMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', type: 'command' })

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      const pkg = manifest.packages[DERIVED_NAME]!
      expect(pkg.packageType).toBe('COMMAND')
      expect(pkg.entryFile).toBe('COMMAND.md')
    })

    it('calls getCommandPlacementPath with the correct agentId and fileName', async () => {
      setupCommandTypeMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', type: 'command' })

      expect(agentDefs.getCommandPlacementPath).toHaveBeenCalledWith(
        'claude-code',
        'COMMAND.md',
        'project'
      )
    })

    it('does not create canonical symlinks for command-type packages', async () => {
      setupCommandTypeMocks()

      await installPackage(TEST_SOURCE, { agent: 'claude-code', type: 'command' })

      expect(canonicalModule.createAgentSymlinks).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // detectPackageType — type override vs auto-detection
  // -------------------------------------------------------------------------

  describe('detectPackageType type override behaviour', () => {
    it('overrides to AGENT when type flag is set', async () => {
      setupHappyPathMocks()

      const agentContent = '# My Agent\n\nAgent content.\n'
      const gitSource = createGitSource()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: [{ path: 'deep-research.md', content: agentContent, size: agentContent.length }],
        commitSha: RESOLVED_SHA,
        source: gitSource,
      })
      vi.mocked(agentDefs.getAgentPlacementPath).mockReturnValue('.claude/agents/deep-research.md')

      await installPackage(TEST_SOURCE, { agent: 'claude-code', type: 'agent' })

      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(manifest.packages[DERIVED_NAME]!.packageType).toBe('AGENT')
    })

    it('rejects multi-markdown packages for AGENT type', async () => {
      setupHappyPathMocks()

      const gitSource = createGitSource()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: [
          { path: 'README.md', content: '# Readme', size: 10 },
          { path: 'agent.md', content: '# Agent', size: 10 },
        ],
        commitSha: RESOLVED_SHA,
        source: gitSource,
      })

      await expect(
        installPackage(TEST_SOURCE, { agent: 'claude-code', type: 'agent' })
      ).rejects.toThrow('Expected exactly one markdown file')
    })

    it('falls through to SKILL when AGENT.md is present but no type override', async () => {
      // AGENT.md is in PACKAGE_STRUCTURES but detectPackageType skips it
      // without a type override, so it should fall through to SKILL
      setupHappyPathMocks()

      const agentMdContent = '# Agent\n\nSome content.\n'
      const skillContent = createSkillMd()
      const gitSource = createGitSource()
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: [
          { path: 'AGENT.md', content: agentMdContent, size: agentMdContent.length },
          { path: 'SKILL.md', content: skillContent, size: skillContent.length },
        ],
        commitSha: RESOLVED_SHA,
        source: gitSource,
      })

      await installPackage(TEST_SOURCE, { agent: 'claude-code' })

      // Without type override, SKILL.md should be detected as a SKILL
      const [, manifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(manifest.packages[DERIVED_NAME]!.packageType).toBeUndefined()
    })
  })
})
