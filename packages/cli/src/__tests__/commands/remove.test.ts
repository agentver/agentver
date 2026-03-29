import { createCLIOutputSchema, removeResultSchema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
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
  isSymlink: vi.fn(),
  isSymlinkedInstall: vi.fn(),
  removeAgentSymlinks: vi.fn(),
  removeCanonicalDirectory: vi.fn(),
}))

vi.mock('../../registry/reporter.js', () => ({
  reportInstallation: vi.fn(),
  reportRemoval: vi.fn(),
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

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  lstatSync: vi.fn().mockReturnValue({ isSymbolicLink: () => false, isDirectory: () => true }),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  renameSync: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { registerRemoveCommand } from '../../commands/remove'

// ---------------------------------------------------------------------------
// Mock module imports
// ---------------------------------------------------------------------------

import * as fs from 'node:fs'
import * as agentDefs from '@agentver/agent-definitions'
import * as outputModule from '../../output.js'
import * as reporterModule from '../../registry/reporter.js'
import * as canonicalModule from '../../storage/canonical'
import * as lockfileModule from '../../storage/lockfile'
import * as manifestModule from '../../storage/manifest'

// ---------------------------------------------------------------------------
// Helper: extract the action callback from registerRemoveCommand
// ---------------------------------------------------------------------------

type RemoveAction = (
  name: string,
  options: { dryRun?: boolean; global?: boolean; yes?: boolean }
) => Promise<void>

function getRemoveAction(): RemoveAction {
  const mockProgram = {
    command: vi.fn().mockReturnThis(),
    alias: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn().mockReturnThis(),
  }

  registerRemoveCommand(mockProgram as never)

  return mockProgram.action.mock.calls[0]![0] as RemoveAction
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
// Shared setup
// ---------------------------------------------------------------------------

function setupInstalledPackage(name: string, agents: string[] = ['claude-code']) {
  const source = createSharedGitSource({
    uri: 'github.com/test-org/test-repo',
    path: 'skills/test-skill',
    ref: 'main',
    commit: 'abc1234567',
  })

  const manifest = createManifest({
    packages: {
      [name]: createManifestPackage({ source, agents }),
    },
  })

  const lockfile = createLockfile({
    packages: {
      [name]: createLockfilePackage({ source, agents }),
    },
  })

  vi.mocked(manifestModule.readManifest).mockReturnValue(manifest)
  vi.mocked(lockfileModule.readLockfile).mockReturnValue(lockfile)
  vi.mocked(canonicalModule.isSymlinkedInstall).mockReturnValue(true)
  vi.mocked(canonicalModule.getCanonicalSkillPath).mockReturnValue(
    `/project/.agents/skills/${name}`
  )

  for (const _agentId of agents) {
    vi.mocked(agentDefs.getSkillPlacementPath).mockImplementation(
      (id: string, skillName: string) => {
        return `.${id}/skills/${skillName}`
      }
    )
  }

  return { manifest, lockfile }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commands/remove', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit

  let removeAction: RemoveAction

  beforeEach(() => {
    vi.clearAllMocks()

    process.cwd = vi.fn().mockReturnValue('/project')
    process.argv = ['node', 'agentver', 'remove']
    process.exit = vi.fn().mockImplementation((code: number) => {
      throw new ExitError(code)
    }) as never

    vi.mocked(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)

    removeAction = getRemoveAction()
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
  })

  // -------------------------------------------------------------------------
  // 1. Happy path removal
  // -------------------------------------------------------------------------

  describe('happy path removal', () => {
    it('removes the package from the manifest', async () => {
      setupInstalledPackage('my-skill')

      await removeAction('my-skill', {})

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [, updatedManifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(updatedManifest.packages).not.toHaveProperty('my-skill')
    })

    it('removes the package from the lockfile', async () => {
      setupInstalledPackage('my-skill')

      await removeAction('my-skill', {})

      expect(lockfileModule.writeLockfile).toHaveBeenCalledTimes(1)
      const [, updatedLockfile] = vi.mocked(lockfileModule.writeLockfile).mock.calls[0]!
      expect(updatedLockfile.packages).not.toHaveProperty('my-skill')
    })

    it('removes agent symlinks when using canonical install pattern', async () => {
      setupInstalledPackage('my-skill', ['claude-code'])

      await removeAction('my-skill', {})

      expect(canonicalModule.removeAgentSymlinks).toHaveBeenCalledWith(
        '/project',
        'my-skill',
        ['claude-code'],
        'project'
      )
    })

    it('removes the canonical directory', async () => {
      setupInstalledPackage('my-skill')

      await removeAction('my-skill', {})

      expect(canonicalModule.removeCanonicalDirectory).toHaveBeenCalledWith(
        '/project',
        'my-skill',
        'project'
      )
    })
  })

  // -------------------------------------------------------------------------
  // 2. Not installed
  // -------------------------------------------------------------------------

  describe('package not installed', () => {
    it('calls process.exit when package is not in manifest', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await expect(removeAction('nonexistent-skill', {})).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('outputs JSON error when package not found in JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await expect(removeAction('nonexistent-skill', {})).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('nonexistent-skill')
      )
    })

    it('does not write manifest when package is not found', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await expect(removeAction('nonexistent-skill', {})).rejects.toThrow(ExitError)

      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 3. Dry run
  // -------------------------------------------------------------------------

  describe('--dry-run', () => {
    it('does not remove files in dry-run mode', async () => {
      setupInstalledPackage('my-skill')

      await removeAction('my-skill', { dryRun: true })

      expect(canonicalModule.removeAgentSymlinks).not.toHaveBeenCalled()
      expect(canonicalModule.removeCanonicalDirectory).not.toHaveBeenCalled()
    })

    it('does not write manifest in dry-run mode', async () => {
      setupInstalledPackage('my-skill')

      await removeAction('my-skill', { dryRun: true })

      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })

    it('does not write lockfile in dry-run mode', async () => {
      setupInstalledPackage('my-skill')

      await removeAction('my-skill', { dryRun: true })

      expect(lockfileModule.writeLockfile).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 4. JSON output
  // -------------------------------------------------------------------------

  describe('--json output', () => {
    it('calls outputSuccess with data matching removeResultSchema on successful removal', async () => {
      setupInstalledPackage('my-skill')
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await removeAction('my-skill', { yes: true })

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typedData = data as Record<string, unknown>

      expect(typedData.name).toBe('my-skill')
      expect(typedData.removed).toBe(true)
      expect(Array.isArray(typedData.paths)).toBe(true)
    })

    it('validates against removeResultSchema', async () => {
      setupInstalledPackage('my-skill')
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await removeAction('my-skill', { yes: true })

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const outputSchema = createCLIOutputSchema(removeResultSchema)
      const envelope = { success: true, data }
      const result = outputSchema.safeParse(envelope)
      expect(result.success).toBe(true)
    })

    it('returns removed: false in dry-run JSON mode', async () => {
      setupInstalledPackage('my-skill')
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await removeAction('my-skill', { dryRun: true })

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typedData = data as Record<string, unknown>
      expect(typedData.removed).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // 5. Multiple agents
  // -------------------------------------------------------------------------

  describe('multiple agents', () => {
    it('removes symlinks for all agents the package was installed for', async () => {
      setupInstalledPackage('my-skill', ['claude-code', 'cursor'])

      await removeAction('my-skill', {})

      expect(canonicalModule.removeAgentSymlinks).toHaveBeenCalledWith(
        '/project',
        'my-skill',
        ['claude-code', 'cursor'],
        'project'
      )
    })
  })

  // -------------------------------------------------------------------------
  // 6. Platform reporting
  // -------------------------------------------------------------------------

  describe('platform reporting', () => {
    it('calls reportRemoval after successful removal', async () => {
      setupInstalledPackage('my-skill')

      await removeAction('my-skill', {})

      expect(reporterModule.reportRemoval).toHaveBeenCalledWith('my-skill')
    })

    it('does not call reportRemoval in dry-run mode', async () => {
      setupInstalledPackage('my-skill')

      await removeAction('my-skill', { dryRun: true })

      expect(reporterModule.reportRemoval).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 7. Partial state — skill directory missing
  // -------------------------------------------------------------------------

  describe('partial state recovery', () => {
    it('still removes manifest and lockfile entries when canonical directory does not exist', async () => {
      setupInstalledPackage('my-skill')
      vi.mocked(canonicalModule.isSymlinkedInstall).mockReturnValue(false)
      vi.mocked(fs.existsSync).mockReturnValue(false)

      await removeAction('my-skill', {})

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      expect(lockfileModule.writeLockfile).toHaveBeenCalledTimes(1)

      const [, updatedManifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(updatedManifest.packages).not.toHaveProperty('my-skill')
    })

    it('does not throw when skill files are missing from disk', async () => {
      setupInstalledPackage('my-skill')
      vi.mocked(canonicalModule.isSymlinkedInstall).mockReturnValue(false)
      vi.mocked(fs.existsSync).mockReturnValue(false)

      await expect(removeAction('my-skill', {})).resolves.not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // 8. Scoped name fallback (org/skill → skill in manifest)
  // -------------------------------------------------------------------------

  describe('scoped name fallback', () => {
    it('finds package stored as short name when removing with org/name', async () => {
      // Install stores as short name 'my-skill'; remove is called with 'org/my-skill'
      setupInstalledPackage('my-skill')

      await removeAction('org/my-skill', {})

      expect(process.exit).not.toHaveBeenCalled()
      expect(manifestModule.writeManifest).toHaveBeenCalled()
      const [, updatedManifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(updatedManifest.packages).not.toHaveProperty('my-skill')
    })

    it('reports removal with the original user-supplied name', async () => {
      setupInstalledPackage('my-skill')

      await removeAction('org/my-skill', {})

      expect(reporterModule.reportRemoval).toHaveBeenCalledWith('org/my-skill')
    })
  })

  // -------------------------------------------------------------------------
  // 9. Case sensitivity
  // -------------------------------------------------------------------------

  describe('case sensitivity', () => {
    it('does not find package when name case does not match manifest key', async () => {
      setupInstalledPackage('my-skill')

      await expect(removeAction('My-Skill', {})).rejects.toThrow(ExitError)

      // Package name lookup is case-sensitive — manifest key 'my-skill' !== 'My-Skill'
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('finds package when exact case matches', async () => {
      setupInstalledPackage('my-skill')

      await removeAction('my-skill', {})

      expect(process.exit).not.toHaveBeenCalled()
      expect(manifestModule.writeManifest).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 10. Global scope removal
  // -------------------------------------------------------------------------

  describe('--global removal', () => {
    function setupGlobalPackage(name: string, agents: string[] = ['claude-code']) {
      const source = createSharedGitSource({
        uri: 'github.com/test-org/test-repo',
        path: 'skills/test-skill',
        ref: 'main',
        commit: 'abc1234567',
      })

      const manifest = createManifest({
        packages: {
          [name]: createManifestPackage({ source, agents }),
        },
      })

      const lockfile = createLockfile({
        packages: {
          [name]: createLockfilePackage({ source, agents }),
        },
      })

      vi.mocked(manifestModule.readManifest).mockReturnValue(manifest)
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(lockfile)
      vi.mocked(canonicalModule.isSymlinkedInstall).mockReturnValue(true)
      vi.mocked(canonicalModule.getCanonicalSkillPath).mockReturnValue(
        `/home/testuser/.agents/skills/${name}`
      )

      vi.mocked(agentDefs.getSkillPlacementPath).mockImplementation(
        (id: string, skillName: string) => `~/.${id}/skills/${skillName}`
      )

      return { manifest, lockfile }
    }

    it('passes global scope to readManifest', async () => {
      setupGlobalPackage('my-skill')

      await removeAction('my-skill', { global: true })

      expect(manifestModule.readManifest).toHaveBeenCalledWith('/project', 'global')
    })

    it('passes global scope to writeManifest', async () => {
      setupGlobalPackage('my-skill')

      await removeAction('my-skill', { global: true })

      expect(manifestModule.writeManifest).toHaveBeenCalledWith(
        '/project',
        expect.any(Object),
        'global'
      )
    })

    it('passes global scope to writeLockfile', async () => {
      setupGlobalPackage('my-skill')

      await removeAction('my-skill', { global: true })

      expect(lockfileModule.writeLockfile).toHaveBeenCalledWith(
        '/project',
        expect.any(Object),
        'global'
      )
    })

    it('passes global scope to removeAgentSymlinks', async () => {
      setupGlobalPackage('my-skill')

      await removeAction('my-skill', { global: true })

      expect(canonicalModule.removeAgentSymlinks).toHaveBeenCalledWith(
        '/project',
        'my-skill',
        ['claude-code'],
        'global'
      )
    })

    it('passes global scope to removeCanonicalDirectory', async () => {
      setupGlobalPackage('my-skill')

      await removeAction('my-skill', { global: true })

      expect(canonicalModule.removeCanonicalDirectory).toHaveBeenCalledWith(
        '/project',
        'my-skill',
        'global'
      )
    })

    it('resolves global paths correctly — no projectRoot prefix in removedPaths', async () => {
      setupGlobalPackage('my-skill')
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await removeAction('my-skill', { global: true, yes: true })

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typedData = data as { paths: string[] }

      for (const p of typedData.paths) {
        expect(p).not.toContain('/project/')
        expect(p).toMatch(/^\/home\/testuser\//)
      }
    })

    it('resolves global paths correctly in dry-run JSON output', async () => {
      setupGlobalPackage('my-skill')
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await removeAction('my-skill', { global: true, dryRun: true })

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typedData = data as { paths: string[] }

      for (const p of typedData.paths) {
        expect(p).not.toContain('/project/')
        expect(p).toMatch(/^\/home\/testuser\//)
      }
    })

    it('package not found in global scope exits with error', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await expect(removeAction('nonexistent', { global: true })).rejects.toThrow(ExitError)

      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('uses direct rmSync with global paths for non-symlinked installs', async () => {
      setupGlobalPackage('legacy-skill', ['claude-code'])
      vi.mocked(canonicalModule.isSymlinkedInstall).mockReturnValue(false)
      vi.mocked(fs.existsSync).mockReturnValue(true)

      await removeAction('legacy-skill', { global: true })

      expect(fs.rmSync).toHaveBeenCalledWith(
        '/home/testuser/.claude-code/skills/legacy-skill',
        expect.objectContaining({ recursive: true })
      )
    })

    it('shows "user" scope label in terminal success message for global removal', async () => {
      setupGlobalPackage('my-skill')
      const mockSpinner = {
        start: vi.fn().mockReturnThis(),
        succeed: vi.fn(),
        fail: vi.fn(),
        stop: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        text: '',
      }
      vi.mocked(outputModule.createSpinner).mockReturnValue(
        mockSpinner as unknown as ReturnType<typeof outputModule.createSpinner>
      )

      await removeAction('my-skill', { global: true })

      expect(mockSpinner.succeed).toHaveBeenCalledWith(expect.stringContaining('user'))
    })
  })

  // -------------------------------------------------------------------------
  // 11. Non-symlinked (legacy) install removal
  // -------------------------------------------------------------------------

  describe('non-symlinked (legacy) install removal', () => {
    it('uses direct file removal when package is not a symlinked install', async () => {
      setupInstalledPackage('legacy-skill', ['claude-code'])
      vi.mocked(canonicalModule.isSymlinkedInstall).mockReturnValue(false)
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => false,
        isDirectory: () => true,
      } as ReturnType<typeof fs.lstatSync>)

      await removeAction('legacy-skill', {})

      // Should use rmSync directly instead of canonical removal
      expect(canonicalModule.removeAgentSymlinks).not.toHaveBeenCalled()
      expect(canonicalModule.removeCanonicalDirectory).not.toHaveBeenCalled()
      expect(fs.rmSync).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 12. Confirmation prompts
  // -------------------------------------------------------------------------

  describe('confirmation prompts', () => {
    it('does not remove when user cancels confirmation', async () => {
      setupInstalledPackage('my-skill')
      const prompts = await import('prompts')
      vi.mocked(prompts.default).mockResolvedValueOnce({ confirmed: false })

      await removeAction('my-skill', {})

      expect(canonicalModule.removeAgentSymlinks).not.toHaveBeenCalled()
      expect(canonicalModule.removeCanonicalDirectory).not.toHaveBeenCalled()
      expect(manifestModule.writeManifest).not.toHaveBeenCalled()
    })

    it('outputs CONFIRMATION_REQUIRED error in JSON mode without --yes', async () => {
      setupInstalledPackage('my-skill')
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await expect(removeAction('my-skill', {})).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'CONFIRMATION_REQUIRED',
        expect.stringContaining('--yes')
      )
    })

    it('proceeds without prompt when --yes is passed', async () => {
      setupInstalledPackage('my-skill')

      await removeAction('my-skill', { yes: true })

      expect(canonicalModule.removeAgentSymlinks).toHaveBeenCalled()
      expect(manifestModule.writeManifest).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 13. Smart UX — case mismatch and wrong scope hints
  // -------------------------------------------------------------------------

  describe('smart hints', () => {
    it('suggests case-insensitive match in JSON error message', async () => {
      setupInstalledPackage('my-skill')
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      await expect(removeAction('My-Skill', {})).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('Did you mean: my-skill')
      )
    })

    it('includes wrong scope hint in JSON error message', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)

      // Set up: empty project manifest, package in global manifest
      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(createManifest()) // project scope (empty)
        .mockReturnValueOnce(
          createManifest({
            packages: { 'my-skill': createManifestPackage() },
          })
        ) // global scope (has package)

      await expect(removeAction('my-skill', {})).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('Found in global scope')
      )
    })

    it('does not suggest other scope when package is not found anywhere', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())

      await expect(removeAction('nonexistent', {})).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        'Package "nonexistent" is not installed.'
      )
    })

    it('shows case-insensitive match hint in terminal error output', async () => {
      setupInstalledPackage('my-skill')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(removeAction('My-Skill', {})).rejects.toThrow(ExitError)

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Did you mean: my-skill'))
      consoleSpy.mockRestore()
    })

    it('shows wrong-scope hint in terminal error output when package is in global scope', async () => {
      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(createManifest())
        .mockReturnValueOnce(
          createManifest({
            packages: { 'my-skill': createManifestPackage() },
          })
        )
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(removeAction('my-skill', {})).rejects.toThrow(ExitError)

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Found in global scope'))
      consoleSpy.mockRestore()
    })

    it('includes project scope hint when package found in project scope with --global', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(createManifest())
        .mockReturnValueOnce(
          createManifest({
            packages: { 'my-skill': createManifestPackage() },
          })
        )

      await expect(removeAction('my-skill', { global: true })).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('Found in project scope')
      )
    })

    it('combines case-mismatch and wrong-scope hints in the same error message', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      // First call (project scope): manifest has 'my-skill' — triggers case-insensitive match for 'My-Skill'
      // Second call (global scope): manifest has 'My-Skill' exactly — triggers foundInOther
      vi.mocked(manifestModule.readManifest)
        .mockReturnValueOnce(createManifest({ packages: { 'my-skill': createManifestPackage() } }))
        .mockReturnValueOnce(createManifest({ packages: { 'My-Skill': createManifestPackage() } }))

      await expect(removeAction('My-Skill', {})).rejects.toThrow(ExitError)

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('Did you mean: my-skill')
      )
      expect(outputModule.outputError).toHaveBeenCalledWith(
        'NOT_FOUND',
        expect.stringContaining('Found in global scope')
      )
    })
  })

  // -------------------------------------------------------------------------
  // Bundle-aware removal
  // -------------------------------------------------------------------------

  describe('bundle-aware removal', () => {
    function setupBundleWithConstituents() {
      const source = createSharedGitSource({
        uri: 'github.com/test-org/bundle-repo',
        ref: 'main',
        commit: 'abc1234567',
      })

      const manifest = createManifest({
        packages: {
          'my-bundle': createManifestPackage({
            source,
            agents: ['claude-code'],
            packageType: 'BUNDLE',
          }),
          'skill-a': createManifestPackage({
            source,
            agents: ['claude-code'],
            bundle: 'my-bundle',
          }),
          'skill-b': createManifestPackage({
            source,
            agents: ['claude-code'],
            bundle: 'my-bundle',
          }),
        },
      })

      const lockfile = createLockfile({
        packages: {
          'my-bundle': createLockfilePackage({ source, agents: ['claude-code'] }),
          'skill-a': createLockfilePackage({ source, agents: ['claude-code'] }),
          'skill-b': createLockfilePackage({ source, agents: ['claude-code'] }),
        },
      })

      vi.mocked(manifestModule.readManifest).mockReturnValue(manifest)
      vi.mocked(lockfileModule.readLockfile).mockReturnValue(lockfile)
      vi.mocked(canonicalModule.isSymlinkedInstall).mockReturnValue(true)
      vi.mocked(canonicalModule.getCanonicalSkillPath).mockImplementation(
        (_root: string, name: string) => `/project/.agents/skills/${name}`
      )
      vi.mocked(agentDefs.getSkillPlacementPath).mockImplementation(
        (id: string, skillName: string) => `.${id}/skills/${skillName}`
      )

      return { manifest, lockfile }
    }

    it('removes all constituents when removing a bundle', async () => {
      setupBundleWithConstituents()

      await removeAction('my-bundle', { yes: true })

      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [, updatedManifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(updatedManifest.packages).not.toHaveProperty('my-bundle')
      expect(updatedManifest.packages).not.toHaveProperty('skill-a')
      expect(updatedManifest.packages).not.toHaveProperty('skill-b')
    })

    it('removes constituents from lockfile when removing a bundle', async () => {
      setupBundleWithConstituents()

      await removeAction('my-bundle', { yes: true })

      expect(lockfileModule.writeLockfile).toHaveBeenCalledTimes(1)
      const [, updatedLockfile] = vi.mocked(lockfileModule.writeLockfile).mock.calls[0]!
      expect(updatedLockfile.packages).not.toHaveProperty('my-bundle')
      expect(updatedLockfile.packages).not.toHaveProperty('skill-a')
      expect(updatedLockfile.packages).not.toHaveProperty('skill-b')
    })

    it('includes bundleConstituents in dry-run JSON output', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      setupBundleWithConstituents()

      await removeAction('my-bundle', { dryRun: true, yes: true })

      expect(outputModule.outputSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my-bundle',
          removed: false,
          bundleConstituents: expect.arrayContaining(['skill-a', 'skill-b']),
        })
      )
    })

    it('allows removing a single constituent with a warning', async () => {
      setupBundleWithConstituents()
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await removeAction('skill-a', { yes: true })

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(output).toContain('installed as part of bundle')

      // Only skill-a removed, not the bundle or skill-b
      expect(manifestModule.writeManifest).toHaveBeenCalledTimes(1)
      const [, updatedManifest] = vi.mocked(manifestModule.writeManifest).mock.calls[0]!
      expect(updatedManifest.packages).not.toHaveProperty('skill-a')
      expect(updatedManifest.packages).toHaveProperty('my-bundle')
      expect(updatedManifest.packages).toHaveProperty('skill-b')

      consoleSpy.mockRestore()
    })

    it('reports removal for each constituent when removing a bundle', async () => {
      setupBundleWithConstituents()

      await removeAction('my-bundle', { yes: true })

      // reportRemoval called for each constituent + the bundle itself
      expect(reporterModule.reportRemoval).toHaveBeenCalledWith('skill-a')
      expect(reporterModule.reportRemoval).toHaveBeenCalledWith('skill-b')
      expect(reporterModule.reportRemoval).toHaveBeenCalledWith('my-bundle')
    })
  })
})
