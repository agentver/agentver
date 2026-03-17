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

type RemoveAction = (name: string, options: { dryRun?: boolean }) => Promise<void>

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

    vi.mocked(outputModule.createSpinner).mockReturnValue(createNoopSpinner() as never)
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

      await removeAction('my-skill', {})

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

      await removeAction('my-skill', {})

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
  // 8. Case sensitivity
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
  // Additional edge cases
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
})
