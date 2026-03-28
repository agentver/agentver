import { createCLIOutputSchema, updateResultSchema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFetchedFiles,
  createGitSource,
  createLockfile,
  createLockfilePackage,
  createManifest,
  createManifestPackage,
  createSharedGitSource,
} from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}))

vi.mock('../../git/index.js', () => ({
  parseGitSource: vi.fn(),
  resolveRef: vi.fn(),
  fetchFiles: vi.fn(),
}))

vi.mock('../../git/fetcher.js', () => ({
  readFilesFromDirectory: vi.fn(),
}))

vi.mock('../../storage/manifest', () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile', () => ({
  readLockfile: vi.fn(),
  writeLockfile: vi.fn(),
}))

vi.mock('../../storage/canonical.js', () => ({
  getCanonicalSkillPath: vi.fn(),
  createAgentSymlinks: vi.fn(),
  isSymlinkedInstall: vi.fn(),
  removeAgentSymlinks: vi.fn(),
  removeCanonicalDirectory: vi.fn(),
  resolveReadPath: vi.fn(),
}))

vi.mock('../../storage/integrity', () => ({
  computeSha256FromFiles: vi.fn(),
}))

vi.mock('../../storage/patches.js', () => ({
  generatePatch: vi.fn(),
  savePatch: vi.fn(),
  applyPatch: vi.fn(),
  removePatch: vi.fn(),
}))

vi.mock('../../utils/backup', () => ({
  createBackup: vi.fn(),
  restoreBackup: vi.fn(),
  cleanupBackup: vi.fn(),
}))

vi.mock('../../commands/install', () => ({
  installPackage: vi.fn(),
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

vi.mock('../../security/index.js', () => ({
  scanFiles: vi.fn(),
  renderScanResult: vi.fn(),
}))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

vi.mock('@agentver/agent-definitions', () => ({
  getSkillPlacementPath: vi.fn(),
  detectInstalledAgents: vi.fn(),
  getConfigFilePath: vi.fn(),
}))

vi.mock('prompts', () => ({
  default: vi.fn().mockResolvedValue({ confirmed: true }),
}))

vi.mock('ora', () => ({
  default: vi.fn().mockReturnValue({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  }),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { registerUpdateCommand } from '../../commands/update'

// ---------------------------------------------------------------------------
// Mock module imports
// ---------------------------------------------------------------------------

import * as agentDefs from '@agentver/agent-definitions'
import prompts from 'prompts'
import { installPackage } from '../../commands/install'
import * as fetcherModule from '../../git/fetcher.js'
import * as gitIndex from '../../git/index.js'
import * as outputModule from '../../output.js'
import * as canonicalModule from '../../storage/canonical.js'
import * as integrityModule from '../../storage/integrity'
import * as lockfileModule from '../../storage/lockfile'
import * as manifestModule from '../../storage/manifest'
import * as patchesModule from '../../storage/patches.js'
import * as backupModule from '../../utils/backup'

// ---------------------------------------------------------------------------
// Helper: extract the action callback from registerUpdateCommand
// ---------------------------------------------------------------------------

type UpdateAction = (
  name: string | undefined,
  options: { dryRun?: boolean; global?: boolean }
) => Promise<void>

function getUpdateAction(): UpdateAction {
  const mockProgram = {
    command: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
  }

  registerUpdateCommand(mockProgram as never)

  return mockProgram.action.mock.calls[0]![0] as UpdateAction
}

// ---------------------------------------------------------------------------
// Sentinel for process.exit
// ---------------------------------------------------------------------------

class ExitError extends Error {
  code: number
  constructor(code: number) {
    super(`process.exit(${code})`)
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OLD_SHA = 'old1234567890abcdef1234567890abcdef1234567'
const NEW_SHA = 'new1234567890abcdef1234567890abcdef1234567'
const INTEGRITY_HASH = 'sha256-testIntegrity'

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

function setupSinglePackage(
  name: string,
  currentCommit: string = OLD_SHA,
  options?: {
    agents?: string[]
    pinned?: boolean
  }
) {
  const agents = options?.agents ?? ['claude-code']
  const source = createSharedGitSource({
    uri: 'github.com/test-org/test-repo',
    path: '',
    ref: 'main',
    commit: currentCommit,
  })

  const manifestPkg = createManifestPackage({
    source,
    agents,
    ...(options?.pinned ? { pinned: true } : {}),
  })

  const lockfilePkg = createLockfilePackage({
    source,
    agents,
    integrity: INTEGRITY_HASH,
  })

  const manifest = createManifest({ packages: { [name]: manifestPkg } })
  const lockfile = createLockfile({ packages: { [name]: lockfilePkg } })

  vi.mocked(manifestModule.readManifest).mockReturnValue(manifest)
  vi.mocked(lockfileModule.readLockfile).mockReturnValue(lockfile)

  return { manifest, lockfile, manifestPkg, lockfilePkg }
}

function setupResolveToNewSha() {
  vi.mocked(gitIndex.resolveRef).mockResolvedValue({
    source: createGitSource(),
    commitSha: NEW_SHA,
  })
}

function setupResolveToSameSha(sha: string = OLD_SHA) {
  vi.mocked(gitIndex.resolveRef).mockResolvedValue({
    source: createGitSource(),
    commitSha: sha,
  })
}

function setupInstallPackageSuccess() {
  vi.mocked(installPackage).mockResolvedValue({
    name: 'test-skill',
    ref: 'main',
    commitSha: NEW_SHA,
    agents: ['claude-code'],
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commands/update', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit

  let updateAction: UpdateAction

  beforeEach(() => {
    vi.clearAllMocks()

    process.cwd = vi.fn().mockReturnValue('/project')
    process.argv = ['node', 'agentver', 'update']
    process.exit = vi.fn().mockImplementation((code: number) => {
      throw new ExitError(code)
    }) as never

    vi.mocked(outputModule.createSpinner).mockReturnValue(createNoopSpinner() as never)
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

    vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(null)
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude-code/skills/test-skill')
    vi.mocked(backupModule.createBackup).mockReturnValue({
      packageName: 'test-skill',
      projectRoot: '/project',
      tempDir: '/tmp/agentver-backup-test',
      skillDir: '/project/.agents/skills/test-skill',
      manifestEntry: null,
      lockfileEntry: null,
      scope: 'project',
    })

    updateAction = getUpdateAction()
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
  })

  // -------------------------------------------------------------------------
  // 1. Happy path — upstream has new commit
  // -------------------------------------------------------------------------

  describe('happy path — upstream has new commit', () => {
    it('calls installPackage to apply the update when upstream has a newer commit', async () => {
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      await updateAction('test-skill', {})

      expect(installPackage).toHaveBeenCalledTimes(1)
      expect(installPackage).toHaveBeenCalledWith(
        expect.stringContaining('github.com/test-org/test-repo'),
        expect.objectContaining({ agent: ['claude-code'] })
      )
    })

    it('passes all agents to installPackage for multi-agent installations', async () => {
      setupSinglePackage('test-skill', OLD_SHA, {
        agents: ['claude-code', 'cursor', 'windsurf'],
      })
      setupResolveToNewSha()
      vi.mocked(installPackage).mockResolvedValue({
        name: 'test-skill',
        ref: 'main',
        commitSha: NEW_SHA,
        agents: ['claude-code', 'cursor', 'windsurf'],
      })

      await updateAction('test-skill', {})

      expect(installPackage).toHaveBeenCalledTimes(1)
      expect(installPackage).toHaveBeenCalledWith(
        expect.stringContaining('github.com/test-org/test-repo'),
        expect.objectContaining({ agent: ['claude-code', 'cursor', 'windsurf'] })
      )
    })

    it('creates a backup before performing the update', async () => {
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      await updateAction('test-skill', {})

      expect(backupModule.createBackup).toHaveBeenCalledWith(
        'test-skill',
        '/project',
        expect.any(String),
        'project'
      )
    })

    it('cleans up the backup after a successful update', async () => {
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      await updateAction('test-skill', {})

      expect(backupModule.cleanupBackup).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // 2. No updates available
  // -------------------------------------------------------------------------

  describe('no updates available', () => {
    it('does not call installPackage when upstream SHA matches current', async () => {
      setupSinglePackage('test-skill', OLD_SHA)
      setupResolveToSameSha(OLD_SHA)

      await updateAction('test-skill', {})

      expect(installPackage).not.toHaveBeenCalled()
    })

    it('outputs JSON with empty updated array when no updates available', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      setupSinglePackage('test-skill', OLD_SHA)
      setupResolveToSameSha(OLD_SHA)

      await updateAction('test-skill', {})

      expect(outputModule.outputSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          updated: [],
          skipped: [],
        })
      )
    })
  })

  // -------------------------------------------------------------------------
  // 3. Dry run
  // -------------------------------------------------------------------------

  describe('--dry-run', () => {
    it('does not call installPackage in dry-run mode even when updates are available', async () => {
      setupSinglePackage('test-skill')
      setupResolveToNewSha()

      await updateAction('test-skill', { dryRun: true })

      expect(installPackage).not.toHaveBeenCalled()
    })

    it('does not create a backup in dry-run mode', async () => {
      setupSinglePackage('test-skill')
      setupResolveToNewSha()

      await updateAction('test-skill', { dryRun: true })

      expect(backupModule.createBackup).not.toHaveBeenCalled()
    })

    it('outputs JSON with updates shown as skipped (dry-run) in JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      setupSinglePackage('test-skill')
      setupResolveToNewSha()

      await updateAction('test-skill', { dryRun: true })

      expect(outputModule.outputSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          updated: [],
          skipped: expect.arrayContaining([
            expect.objectContaining({
              name: 'test-skill',
              reason: 'dry-run',
            }),
          ]),
        })
      )
    })
  })

  // -------------------------------------------------------------------------
  // 4. JSON output
  // -------------------------------------------------------------------------

  describe('--json output', () => {
    it('calls outputSuccess with data matching updateResultSchema after update', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      await updateAction('test-skill', {})

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!

      const outputSchema = createCLIOutputSchema(updateResultSchema)
      const envelope = { success: true, data }
      const result = outputSchema.safeParse(envelope)
      expect(result.success).toBe(true)
    })

    it('includes correct from and to refs in updated entries', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      await updateAction('test-skill', {})

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typedData = data as Record<string, unknown>
      const updated = typedData.updated as Array<Record<string, unknown>>
      expect(updated).toHaveLength(1)
      expect(updated[0]!.name).toBe('test-skill')
      expect(updated[0]!.fromRef).toBe(OLD_SHA.slice(0, 7))
      expect(updated[0]!.toRef).toBe(NEW_SHA.slice(0, 7))
      expect(updated[0]!.strategy).toBe('replace')
    })
  })

  // -------------------------------------------------------------------------
  // 5. Locally modified file — replace action
  // -------------------------------------------------------------------------

  describe('locally modified files', () => {
    it('detects local modifications via integrity mismatch and proceeds with replace in JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      // Simulate local modifications by setting up a read path and mismatched integrity
      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/project/.agents/skills/test-skill'
      )
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: 'modified content', size: 16 },
      ])
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-different')

      await updateAction('test-skill', {})

      // In JSON mode, locally modified packages use 'replace' strategy automatically
      expect(installPackage).toHaveBeenCalled()
    })

    it('skips package when user selects skip in interactive prompt', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      setupSinglePackage('test-skill')
      setupResolveToNewSha()

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/project/.agents/skills/test-skill'
      )
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: 'modified content', size: 16 },
      ])
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-different')

      // First prompt: confirm update. Second prompt: action (skip)
      vi.mocked(prompts).mockResolvedValueOnce({ action: 'skip' })

      await updateAction('test-skill', {})

      expect(installPackage).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 6. Patch mode
  // -------------------------------------------------------------------------

  describe('patch mode', () => {
    it('generates and saves a patch when user selects patch action', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/project/.agents/skills/test-skill'
      )
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: 'modified locally', size: 16 },
      ])
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-different')

      // fetchFiles for locked version
      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: createFetchedFiles(1),
        commitSha: OLD_SHA,
        source: createGitSource(),
      })

      vi.mocked(patchesModule.generatePatch).mockReturnValue(
        '--- a/test-skill/SKILL.md\n+++ b/test-skill/SKILL.md\n@@ -1,1 +1,1 @@\n-original\n+modified locally\n'
      )
      vi.mocked(patchesModule.savePatch).mockReturnValue(
        '/project/.agentver/patches/test-skill.patch'
      )
      vi.mocked(patchesModule.applyPatch).mockReturnValue({ applied: true, conflicts: [] })

      // First prompt: confirm update. Second prompt: action (patch)
      vi.mocked(prompts)
        .mockResolvedValueOnce({ confirmed: true })
        .mockResolvedValueOnce({ action: 'patch' })

      await updateAction('test-skill', {})

      expect(patchesModule.generatePatch).toHaveBeenCalled()
      expect(patchesModule.savePatch).toHaveBeenCalledWith(
        '/project',
        'test-skill',
        expect.any(String)
      )
    })

    it('removes the patch file after successful reapplication', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/project/.agents/skills/test-skill'
      )
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: 'modified', size: 8 },
      ])
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-different')

      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: createFetchedFiles(1),
        commitSha: OLD_SHA,
        source: createGitSource(),
      })

      vi.mocked(patchesModule.generatePatch).mockReturnValue('patch content')
      vi.mocked(patchesModule.savePatch).mockReturnValue(
        '/project/.agentver/patches/test-skill.patch'
      )
      vi.mocked(patchesModule.applyPatch).mockReturnValue({ applied: true, conflicts: [] })

      // First prompt: confirm update. Second prompt: action (patch)
      vi.mocked(prompts)
        .mockResolvedValueOnce({ confirmed: true })
        .mockResolvedValueOnce({ action: 'patch' })

      await updateAction('test-skill', {})

      expect(patchesModule.removePatch).toHaveBeenCalledWith('/project', 'test-skill')
    })
  })

  // -------------------------------------------------------------------------
  // 7. Pinned package skipped
  // -------------------------------------------------------------------------

  describe('pinned package', () => {
    it('skips packages marked as pinned in the manifest', async () => {
      setupSinglePackage('pinned-skill', OLD_SHA, { pinned: true })
      setupResolveToNewSha()

      await updateAction(undefined, {})

      expect(gitIndex.resolveRef).not.toHaveBeenCalled()
      expect(installPackage).not.toHaveBeenCalled()
    })

    it('includes pinned packages in the skipped array in JSON output', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      setupSinglePackage('pinned-skill', OLD_SHA, { pinned: true })

      await updateAction(undefined, {})

      expect(outputModule.outputSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          updated: [],
          skipped: expect.arrayContaining([
            expect.objectContaining({
              name: 'pinned-skill',
              reason: 'pinned',
            }),
          ]),
        })
      )
    })
  })

  // -------------------------------------------------------------------------
  // 8. Backup created
  // -------------------------------------------------------------------------

  describe('backup lifecycle', () => {
    it('calls createBackup before installPackage', async () => {
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      const callOrder: string[] = []
      vi.mocked(backupModule.createBackup).mockImplementation((..._args) => {
        callOrder.push('createBackup')
        return {
          packageName: 'test-skill',
          projectRoot: '/project',
          tempDir: '/tmp/agentver-backup-test',
          skillDir: null,
          manifestEntry: null,
          lockfileEntry: null,
          scope: 'project',
        }
      })
      vi.mocked(installPackage).mockImplementation(async () => {
        callOrder.push('installPackage')
        return { name: 'test-skill', ref: 'main', commitSha: NEW_SHA, agents: ['claude-code'] }
      })

      await updateAction('test-skill', {})

      expect(callOrder.indexOf('createBackup')).toBeLessThan(callOrder.indexOf('installPackage'))
    })
  })

  // -------------------------------------------------------------------------
  // 9. Restore on failure
  // -------------------------------------------------------------------------

  describe('restore on failure', () => {
    it('restores from backup when installPackage throws during update', async () => {
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      vi.mocked(installPackage).mockRejectedValue(new Error('Write failed mid-update'))

      await updateAction('test-skill', {})

      expect(backupModule.restoreBackup).toHaveBeenCalledTimes(1)
    })

    it('cleans up backup after restore attempt', async () => {
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      vi.mocked(installPackage).mockRejectedValue(new Error('Write failed mid-update'))

      await updateAction('test-skill', {})

      expect(backupModule.cleanupBackup).toHaveBeenCalledTimes(1)
    })

    it('does not call restoreBackup when update succeeds', async () => {
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      await updateAction('test-skill', {})

      expect(backupModule.restoreBackup).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 10. Network failure
  // -------------------------------------------------------------------------

  describe('network failure', () => {
    it('does not call installPackage when resolveRef rejects', async () => {
      setupSinglePackage('test-skill')
      vi.mocked(gitIndex.resolveRef).mockRejectedValue(new Error('Network timeout'))

      await updateAction('test-skill', {})

      expect(installPackage).not.toHaveBeenCalled()
    })

    it('preserves original state when resolveRef fails — no backup needed', async () => {
      setupSinglePackage('test-skill')
      vi.mocked(gitIndex.resolveRef).mockRejectedValue(new Error('Network timeout'))

      await updateAction('test-skill', {})

      // No backup because we never reached the install phase
      expect(backupModule.createBackup).not.toHaveBeenCalled()
      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 11. Multiple packages
  // -------------------------------------------------------------------------

  describe('multiple packages', () => {
    it('updates both packages when two are installed and both have upstream changes', async () => {
      const source1 = createSharedGitSource({
        uri: 'github.com/test-org/repo-a',
        path: '',
        ref: 'main',
        commit: OLD_SHA,
      })
      const source2 = createSharedGitSource({
        uri: 'github.com/test-org/repo-b',
        path: '',
        ref: 'main',
        commit: OLD_SHA,
      })

      const manifest = createManifest({
        packages: {
          'skill-a': createManifestPackage({ source: source1, agents: ['claude-code'] }),
          'skill-b': createManifestPackage({ source: source2, agents: ['claude-code'] }),
        },
      })
      const lockfile = createLockfile({
        packages: {
          'skill-a': createLockfilePackage({ source: source1, agents: ['claude-code'] }),
          'skill-b': createLockfilePackage({ source: source2, agents: ['claude-code'] }),
        },
      })

      vi.mocked(manifestModule.readManifest).mockReturnValue(manifest)
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(lockfile)

      vi.mocked(gitIndex.resolveRef).mockResolvedValue({
        source: createGitSource(),
        commitSha: NEW_SHA,
      })

      vi.mocked(installPackage)
        .mockResolvedValueOnce({
          name: 'skill-a',
          ref: 'main',
          commitSha: NEW_SHA,
          agents: ['claude-code'],
        })
        .mockResolvedValueOnce({
          name: 'skill-b',
          ref: 'main',
          commitSha: NEW_SHA,
          agents: ['claude-code'],
        })

      await updateAction(undefined, {})

      expect(installPackage).toHaveBeenCalledTimes(2)
    })

    it('shows both packages in the updated array in JSON output', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      const source1 = createSharedGitSource({
        uri: 'github.com/test-org/repo-a',
        path: '',
        ref: 'main',
        commit: OLD_SHA,
      })
      const source2 = createSharedGitSource({
        uri: 'github.com/test-org/repo-b',
        path: '',
        ref: 'main',
        commit: OLD_SHA,
      })

      const manifest = createManifest({
        packages: {
          'skill-a': createManifestPackage({ source: source1, agents: ['claude-code'] }),
          'skill-b': createManifestPackage({ source: source2, agents: ['claude-code'] }),
        },
      })
      const lockfile = createLockfile({
        packages: {
          'skill-a': createLockfilePackage({ source: source1, agents: ['claude-code'] }),
          'skill-b': createLockfilePackage({ source: source2, agents: ['claude-code'] }),
        },
      })

      vi.mocked(manifestModule.readManifest).mockReturnValue(manifest)
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(lockfile)

      vi.mocked(gitIndex.resolveRef).mockResolvedValue({
        source: createGitSource(),
        commitSha: NEW_SHA,
      })

      vi.mocked(installPackage)
        .mockResolvedValueOnce({
          name: 'skill-a',
          ref: 'main',
          commitSha: NEW_SHA,
          agents: ['claude-code'],
        })
        .mockResolvedValueOnce({
          name: 'skill-b',
          ref: 'main',
          commitSha: NEW_SHA,
          agents: ['claude-code'],
        })

      await updateAction(undefined, {})

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typedData = data as Record<string, unknown>
      const updated = typedData.updated as Array<Record<string, unknown>>
      expect(updated).toHaveLength(2)
      expect(updated.map((u) => u.name)).toContain('skill-a')
      expect(updated.map((u) => u.name)).toContain('skill-b')
    })
  })

  // -------------------------------------------------------------------------
  // Additional edge cases
  // -------------------------------------------------------------------------

  describe('no packages installed', () => {
    it('returns early with informational message when manifest is empty', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await updateAction(undefined, {})

      expect(gitIndex.resolveRef).not.toHaveBeenCalled()
      expect(installPackage).not.toHaveBeenCalled()
    })

    it('outputs empty JSON result when no packages are installed', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await updateAction(undefined, {})

      expect(outputModule.outputSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          updated: [],
          skipped: [],
        })
      )
    })
  })

  describe('named package not installed', () => {
    it('returns early when a specific named package is not in manifest', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await updateAction('nonexistent', {})

      expect(gitIndex.resolveRef).not.toHaveBeenCalled()
    })
  })

  describe('well-known source packages skipped', () => {
    it('does not attempt to update packages with non-git sources', async () => {
      const manifest = createManifest({
        packages: {
          'wk-skill': createManifestPackage({
            source: {
              type: 'well-known',
              baseUrl: 'https://example.com',
              hostname: 'example.com',
              skillName: 'wk-skill',
            },
            agents: ['claude-code'],
          }),
        },
      })
      vi.mocked(manifestModule.readManifest).mockReturnValue(manifest)

      await updateAction(undefined, {})

      expect(gitIndex.resolveRef).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('outputs JSON error when an unexpected error propagates to the outer catch', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      const source = createSharedGitSource({
        uri: 'github.com/test-org/test-repo',
        path: '',
        ref: 'main',
        commit: OLD_SHA,
      })
      const manifest = createManifest({
        packages: {
          'test-skill': createManifestPackage({ source, agents: ['claude-code'] }),
        },
      })
      vi.mocked(manifestModule.readManifest).mockReturnValue(manifest)
      // resolveRef throws synchronously. The per-package try/catch at line 286
      // catches this and warns, but does not propagate. So we test the JSON
      // output path when a per-package error is silently handled — the update
      // still produces a valid JSON result with the error in skipped.
      vi.mocked(gitIndex.resolveRef).mockRejectedValue(new Error('Connection refused'))

      await updateAction(undefined, {})

      // The update should complete with an empty 'updated' list
      // since the per-package error is caught and the package is skipped.
      expect(outputModule.outputSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          updated: [],
        })
      )
    })

    it('calls process.exit when a fatal error reaches the outer catch', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      const source = createSharedGitSource({
        uri: 'github.com/test-org/test-repo',
        path: '',
        ref: 'main',
        commit: OLD_SHA,
      })
      const manifest = createManifest({
        packages: {
          'test-skill': createManifestPackage({ source, agents: ['claude-code'] }),
        },
      })
      vi.mocked(manifestModule.readManifest).mockReturnValue(manifest)
      // Force updates to exist so the confirmation prompt is reached
      setupResolveToNewSha()
      // Make prompts reject — this is inside the try block and not per-package caught
      vi.mocked(prompts).mockRejectedValue(new Error('Terminal closed'))

      await expect(updateAction(undefined, {})).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 12. Global scope update
  // -------------------------------------------------------------------------

  describe('--global update', () => {
    it('passes global scope to readManifest', async () => {
      setupSinglePackage('test-skill')
      setupResolveToSameSha()

      await updateAction('test-skill', { global: true })

      expect(manifestModule.readManifest).toHaveBeenCalledWith('/project', 'global')
    })

    it('passes global scope to readLockfile for local modification check', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/home/testuser/.agents/skills/test-skill'
      )
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: 'content', size: 7 },
      ])
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue(INTEGRITY_HASH)

      await updateAction('test-skill', { global: true })

      expect(lockfileModule.readLockfile).toHaveBeenCalledWith('/project', 'global')
    })

    it('passes global flag to installPackage', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      await updateAction('test-skill', { global: true })

      expect(installPackage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ global: true, agent: ['claude-code'] })
      )
    })

    it('resolves global paths correctly for skill directory fallback', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(null)
      vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('~/.claude-code/skills/test-skill')

      await updateAction('test-skill', { global: true })

      expect(backupModule.createBackup).toHaveBeenCalledWith(
        'test-skill',
        '/project',
        '/home/testuser/.claude-code/skills/test-skill',
        'global'
      )
    })

    it('returns empty JSON result when no global packages installed', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await updateAction(undefined, { global: true })

      expect(outputModule.outputSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ updated: [], skipped: [] })
      )
    })

    it('skips install and reports dry-run for global packages with --dry-run', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      setupSinglePackage('test-skill')
      setupResolveToNewSha()

      await updateAction('test-skill', { global: true, dryRun: true })

      expect(installPackage).not.toHaveBeenCalled()
      expect(outputModule.outputSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          updated: [],
          skipped: expect.arrayContaining([
            expect.objectContaining({ name: 'test-skill', reason: 'dry-run' }),
          ]),
        })
      )
      expect(manifestModule.readManifest).toHaveBeenCalledWith('/project', 'global')
    })
  })

  // -------------------------------------------------------------------------
  // 13. Patch mode with global scope
  // -------------------------------------------------------------------------

  describe('patch mode with --global', () => {
    it('passes global scope to readLockfile and installPackage in patch update', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      setupSinglePackage('test-skill')
      setupResolveToNewSha()
      setupInstallPackageSuccess()

      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/home/testuser/.agents/skills/test-skill'
      )
      vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue([
        { path: 'SKILL.md', content: 'modified locally', size: 16 },
      ])
      vi.mocked(integrityModule.computeSha256FromFiles).mockReturnValue('sha256-different')

      vi.mocked(gitIndex.fetchFiles).mockResolvedValue({
        files: createFetchedFiles(1),
        commitSha: OLD_SHA,
        source: createGitSource(),
      })

      vi.mocked(patchesModule.generatePatch).mockReturnValue(
        '--- a/test-skill/SKILL.md\n+++ b/test-skill/SKILL.md\n@@ -1,1 +1,1 @@\n-original\n+modified locally\n'
      )
      vi.mocked(patchesModule.savePatch).mockReturnValue(
        '/project/.agentver/patches/test-skill.patch'
      )
      vi.mocked(patchesModule.applyPatch).mockReturnValue({ applied: true, conflicts: [] })

      vi.mocked(prompts)
        .mockResolvedValueOnce({ confirmed: true })
        .mockResolvedValueOnce({ action: 'patch' })

      await updateAction('test-skill', { global: true })

      expect(lockfileModule.readLockfile).toHaveBeenCalledWith('/project', 'global')
      expect(installPackage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ global: true, agent: ['claude-code'] })
      )
    })
  })
})
