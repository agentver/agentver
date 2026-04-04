import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLockfile, createManifest, createManifestPackage } from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

vi.mock('node:fs', () => ({
  copyFileSync: vi.fn(),
  cpSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn().mockReturnValue('/tmp/agentver-migrate-backup'),
  rmSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

vi.mock('@agentver/agent-definitions', () => ({
  getSkillPlacementPath: vi.fn(),
}))

vi.mock('../../output.js', () => ({
  createSpinner: vi.fn(),
  isJSONMode: vi.fn().mockReturnValue(false),
  outputError: vi.fn(),
  outputSuccess: vi.fn(),
}))

vi.mock('../../storage/canonical.js', () => ({
  createAgentSymlinks: vi.fn(),
  createFileSymlinks: vi.fn(),
  findAgentSkillPlacementConflicts: vi.fn().mockReturnValue([]),
  getCanonicalFilePath: vi.fn(),
  getCanonicalSkillPath: vi.fn(),
  getFilePlacementPath: vi.fn(),
  removeAgentSymlinks: vi.fn(),
  removeFileSymlinks: vi.fn(),
  resolveReadPath: vi.fn(),
}))

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile.js', () => ({
  readLockfile: vi.fn(),
}))

vi.mock('../../storage/pair.js', () => ({
  updateManifestAndLockfile: vi.fn(),
}))

vi.mock('../../utils/backup.js', () => ({
  cleanupBackup: vi.fn(),
  createFilesystemBackup: vi.fn().mockReturnValue({
    tempDir: '/tmp/agentver-migrate-backup',
    targets: [
      {
        originalPath: '/project/.claude/skills/test-skill',
        backupPath: '/tmp/agentver-migrate-backup/target-0',
      },
    ],
  }),
  restoreFilesystemBackup: vi.fn(),
}))

vi.mock('prompts', () => ({ default: vi.fn() }))

import * as nodeFs from 'node:fs'
import * as agentDefs from '@agentver/agent-definitions'
import promptsFn from 'prompts'
import { migrateSkills } from '../../commands/migrate'
import * as outputModule from '../../output.js'
import * as canonicalModule from '../../storage/canonical.js'
import * as lockfileModule from '../../storage/lockfile.js'
import * as manifestModule from '../../storage/manifest.js'
import * as pairModule from '../../storage/pair.js'
import * as backupModule from '../../utils/backup.js'

describe('commands/migrate', () => {
  const originalCwd = process.cwd
  const originalExit = process.exit

  let manifest: ManifestV2
  let lockfile: LockfileV2

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn().mockReturnValue('/project')
    process.exit = vi.fn() as never

    manifest = createManifest()
    lockfile = createLockfile()

    vi.mocked(outputModule.createSpinner).mockReturnValue(
      createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>
    )
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
    vi.mocked(manifestModule.readManifest).mockImplementation(() => manifest)
    vi.mocked(lockfileModule.readLockfile).mockImplementation(() => lockfile)
    vi.mocked(pairModule.updateManifestAndLockfile).mockImplementation(
      (_projectRoot, _scope, updater) => {
        const updated = updater(structuredClone(manifest), structuredClone(lockfile))
        manifest = updated.manifest
        lockfile = updated.lockfile
        return updated
      }
    )
    vi.mocked(canonicalModule.getCanonicalSkillPath).mockReturnValue(
      '/project/.agents/skills/test-skill'
    )
    vi.mocked(canonicalModule.resolveReadPath).mockReturnValue('/project/.claude/skills/test-skill')
    vi.mocked(canonicalModule.createAgentSymlinks).mockImplementation(() => {})
    vi.mocked(canonicalModule.findAgentSkillPlacementConflicts).mockReturnValue([])
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test-skill')
    vi.mocked(nodeFs.existsSync).mockImplementation(
      (path) =>
        String(path) === '/project/.claude/skills/test-skill' ||
        String(path) === '/tmp/agentver-migrate-backup/target-0'
    )
    vi.mocked(backupModule.createFilesystemBackup).mockReturnValue({
      tempDir: '/tmp/agentver-migrate-backup',
      targets: [
        {
          originalPath: '/project/.claude/skills/test-skill',
          backupPath: '/tmp/agentver-migrate-backup/target-0',
        },
      ],
    })
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.exit = originalExit
  })

  // -------------------------------------------------------------------------
  // Existing tests
  // -------------------------------------------------------------------------

  it('reports a dry-run migration without changing files', async () => {
    manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage(),
      },
    })

    await migrateSkills(undefined, { dryRun: true })

    expect(outputModule.outputSuccess).not.toHaveBeenCalled()
    expect(nodeFs.cpSync).not.toHaveBeenCalled()
    expect(nodeFs.rmSync).not.toHaveBeenCalled()
  })

  it('skips packages that already use canonical storage', async () => {
    manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage(),
      },
    })
    vi.mocked(canonicalModule.resolveReadPath).mockReturnValue('/project/.agents/skills/test-skill')
    vi.mocked(nodeFs.existsSync).mockReturnValue(true)

    await migrateSkills(undefined, {})

    expect(canonicalModule.createAgentSymlinks).not.toHaveBeenCalled()
    expect(nodeFs.cpSync).not.toHaveBeenCalled()
  })

  it('migrates an adopted local skill into canonical storage and updates tracked paths', async () => {
    manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage({
          source: {
            type: 'local',
            path: '/project/.claude/skills/test-skill',
          },
        }),
      },
    })
    lockfile = createLockfile({
      packages: {
        'test-skill': {
          source: {
            type: 'local',
            path: '/project/.claude/skills/test-skill',
          },
          integrity: 'sha256-test',
          agents: ['claude-code'],
        },
      },
    })
    vi.mocked(nodeFs.existsSync).mockImplementation(
      (path) => String(path) === '/project/.claude/skills/test-skill'
    )

    await migrateSkills(undefined, { yes: true })

    expect(nodeFs.cpSync).toHaveBeenCalledWith(
      '/project/.claude/skills/test-skill',
      '/project/.agents/skills/test-skill',
      expect.objectContaining({ recursive: true, dereference: true })
    )
    expect(canonicalModule.createAgentSymlinks).toHaveBeenCalledWith(
      '/project',
      'test-skill',
      ['claude-code'],
      'project'
    )
    expect(manifest.packages['test-skill']?.source.type).toBe('local')
    if (manifest.packages['test-skill']?.source.type === 'local') {
      expect(manifest.packages['test-skill'].source.path).toBe('/project/.agents/skills/test-skill')
    }
    expect(lockfile.packages['test-skill']?.source.type).toBe('local')
    if (lockfile.packages['test-skill']?.source.type === 'local') {
      expect(lockfile.packages['test-skill'].source.path).toBe('/project/.agents/skills/test-skill')
    }
  })

  it('restores the original filesystem when symlink creation fails', async () => {
    manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage({
          source: {
            type: 'local',
            path: '/project/.claude/skills/test-skill',
          },
        }),
      },
    })
    lockfile = createLockfile({
      packages: {
        'test-skill': {
          source: {
            type: 'local',
            path: '/project/.claude/skills/test-skill',
          },
          integrity: 'sha256-test',
          agents: ['claude-code'],
        },
      },
    })
    vi.mocked(nodeFs.existsSync).mockImplementation(
      (path) => String(path) === '/project/.claude/skills/test-skill'
    )
    vi.mocked(canonicalModule.createAgentSymlinks).mockImplementation(() => {
      throw new Error('symlink failure')
    })

    await migrateSkills(undefined, { yes: true })

    expect(backupModule.restoreFilesystemBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        tempDir: '/tmp/agentver-migrate-backup',
      })
    )
    expect(backupModule.cleanupBackup).toHaveBeenCalled()
    expect(nodeFs.rmSync).toHaveBeenCalledWith('/project/.agents/skills/test-skill', {
      recursive: true,
      force: true,
    })
  })

  it('outputs CONFIRMATION_REQUIRED in JSON mode without --yes', async () => {
    manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage({
          source: {
            type: 'local',
            path: '/project/.claude/skills/test-skill',
          },
        }),
      },
    })
    lockfile = createLockfile({
      packages: {
        'test-skill': {
          source: {
            type: 'local',
            path: '/project/.claude/skills/test-skill',
          },
          integrity: 'sha256-test',
          agents: ['claude-code'],
        },
      },
    })
    vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
    vi.mocked(nodeFs.existsSync).mockImplementation(
      (path) => String(path) === '/project/.claude/skills/test-skill'
    )

    await migrateSkills(undefined, {})

    expect(outputModule.outputError).toHaveBeenCalledWith(
      'CONFIRMATION_REQUIRED',
      expect.stringContaining('Re-run with --yes to continue.')
    )
    expect(nodeFs.cpSync).not.toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  // -------------------------------------------------------------------------
  // New tests: --global scope handling
  // -------------------------------------------------------------------------

  describe('--global flag scope handling', () => {
    it('passes global scope to readManifest and downstream calls', async () => {
      manifest = createManifest({
        packages: {
          'test-skill': createManifestPackage({
            source: {
              type: 'local',
              path: '/project/.claude/skills/test-skill',
            },
          }),
        },
      })
      lockfile = createLockfile({
        packages: {
          'test-skill': {
            source: {
              type: 'local',
              path: '/project/.claude/skills/test-skill',
            },
            integrity: 'sha256-test',
            agents: ['claude-code'],
          },
        },
      })
      vi.mocked(nodeFs.existsSync).mockImplementation(
        (path) => String(path) === '/project/.claude/skills/test-skill'
      )

      await migrateSkills(undefined, { global: true, yes: true })

      expect(manifestModule.readManifest).toHaveBeenCalledWith('/project', 'global')
      expect(canonicalModule.getCanonicalSkillPath).toHaveBeenCalledWith(
        '/project',
        'test-skill',
        'global'
      )
      expect(canonicalModule.createAgentSymlinks).toHaveBeenCalledWith(
        '/project',
        'test-skill',
        ['claude-code'],
        'global'
      )
    })
  })

  // -------------------------------------------------------------------------
  // New tests: JSON output validation
  // -------------------------------------------------------------------------

  describe('JSON output', () => {
    it('emits a structured migration result in JSON mode with --yes', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      manifest = createManifest({
        packages: {
          'test-skill': createManifestPackage({
            source: {
              type: 'local',
              path: '/project/.claude/skills/test-skill',
            },
          }),
        },
      })
      lockfile = createLockfile({
        packages: {
          'test-skill': {
            source: {
              type: 'local',
              path: '/project/.claude/skills/test-skill',
            },
            integrity: 'sha256-test',
            agents: ['claude-code'],
          },
        },
      })
      vi.mocked(nodeFs.existsSync).mockImplementation(
        (path) => String(path) === '/project/.claude/skills/test-skill'
      )

      await migrateSkills(undefined, { yes: true })

      expect(outputModule.outputSuccess).toHaveBeenCalledTimes(1)
      const emitted = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        migrated: Array<{ name: string; from: string; to: string }>
        skipped: Array<{ name: string; reason: string }>
      }

      expect(emitted.migrated).toHaveLength(1)
      expect(emitted.migrated[0]).toEqual({
        name: 'test-skill',
        from: '/project/.claude/skills/test-skill',
        to: '/project/.agents/skills/test-skill',
      })
      expect(emitted.skipped).toHaveLength(0)
    })

    it('includes skipped packages with reasons in JSON output', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      manifest = createManifest({
        packages: {
          'test-skill': createManifestPackage(),
        },
      })
      // Already canonical — should be skipped
      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/project/.agents/skills/test-skill'
      )
      vi.mocked(nodeFs.existsSync).mockReturnValue(true)

      await migrateSkills(undefined, { yes: true })

      expect(outputModule.outputSuccess).toHaveBeenCalledTimes(1)
      const emitted = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        migrated: Array<{ name: string; from: string; to: string }>
        skipped: Array<{ name: string; reason: string }>
      }

      expect(emitted.migrated).toHaveLength(0)
      expect(emitted.skipped).toHaveLength(1)
      expect(emitted.skipped[0]!.reason).toContain('canonical')
    })
  })

  // -------------------------------------------------------------------------
  // New tests: Multiple packages migration (batch)
  // -------------------------------------------------------------------------

  describe('batch migration of multiple packages', () => {
    it('migrates multiple packages in a single run', async () => {
      manifest = createManifest({
        packages: {
          'skill-a': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/skills/skill-a' },
            agents: ['claude-code'],
          }),
          'skill-b': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/skills/skill-b' },
            agents: ['cursor'],
          }),
        },
      })
      lockfile = createLockfile({
        packages: {
          'skill-a': {
            source: { type: 'local', path: '/project/.claude/skills/skill-a' },
            integrity: 'sha256-a',
            agents: ['claude-code'],
          },
          'skill-b': {
            source: { type: 'local', path: '/project/.claude/skills/skill-b' },
            integrity: 'sha256-b',
            agents: ['cursor'],
          },
        },
      })

      vi.mocked(canonicalModule.getCanonicalSkillPath).mockImplementation(
        (_root, name) => `/project/.agents/skills/${name}`
      )
      vi.mocked(canonicalModule.resolveReadPath).mockImplementation(
        (_root, name) => `/project/.claude/skills/${name}`
      )
      vi.mocked(agentDefs.getSkillPlacementPath).mockImplementation(
        (_agent, name) => `.claude/skills/${name}`
      )
      vi.mocked(nodeFs.existsSync).mockImplementation((path) => {
        const pathStr = String(path)
        return (
          pathStr === '/project/.claude/skills/skill-a' ||
          pathStr === '/project/.claude/skills/skill-b'
        )
      })

      await migrateSkills(undefined, { yes: true })

      expect(nodeFs.cpSync).toHaveBeenCalledTimes(2)
      expect(canonicalModule.createAgentSymlinks).toHaveBeenCalledTimes(2)
      expect(canonicalModule.createAgentSymlinks).toHaveBeenCalledWith(
        '/project',
        'skill-a',
        ['claude-code'],
        'project'
      )
      expect(canonicalModule.createAgentSymlinks).toHaveBeenCalledWith(
        '/project',
        'skill-b',
        ['cursor'],
        'project'
      )
    })
  })

  // -------------------------------------------------------------------------
  // New tests: Package already in canonical location (skip)
  // -------------------------------------------------------------------------

  describe('package already in canonical location', () => {
    it('skips migration when read path equals canonical path', async () => {
      manifest = createManifest({
        packages: {
          'test-skill': createManifestPackage(),
        },
      })
      // Read path matches canonical — no migration needed
      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/project/.agents/skills/test-skill'
      )

      await migrateSkills(undefined, { yes: true })

      expect(nodeFs.cpSync).not.toHaveBeenCalled()
      expect(canonicalModule.createAgentSymlinks).not.toHaveBeenCalled()
    })

    it('skips when canonical path already exists on disc', async () => {
      manifest = createManifest({
        packages: {
          'test-skill': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/skills/test-skill' },
          }),
        },
      })
      // readPath differs from canonical, but canonical already exists on disc
      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/project/.claude/skills/test-skill'
      )
      vi.mocked(nodeFs.existsSync).mockImplementation((path) => {
        const pathStr = String(path)
        return (
          pathStr === '/project/.claude/skills/test-skill' ||
          pathStr === '/project/.agents/skills/test-skill'
        )
      })

      await migrateSkills(undefined, { yes: true })

      expect(nodeFs.cpSync).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // New tests: Rollback on failure (backup restore)
  // -------------------------------------------------------------------------

  describe('rollback on failure', () => {
    it('restores filesystem backup and removes canonical dir when cpSync fails', async () => {
      manifest = createManifest({
        packages: {
          'test-skill': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/skills/test-skill' },
          }),
        },
      })
      lockfile = createLockfile({
        packages: {
          'test-skill': {
            source: { type: 'local', path: '/project/.claude/skills/test-skill' },
            integrity: 'sha256-test',
            agents: ['claude-code'],
          },
        },
      })
      vi.mocked(nodeFs.existsSync).mockImplementation(
        (path) => String(path) === '/project/.claude/skills/test-skill'
      )

      // cpSync succeeds but createAgentSymlinks throws
      vi.mocked(canonicalModule.createAgentSymlinks).mockImplementation(() => {
        throw new Error('permission denied creating symlinks')
      })

      await migrateSkills(undefined, { yes: true })

      expect(backupModule.restoreFilesystemBackup).toHaveBeenCalled()
      expect(backupModule.cleanupBackup).toHaveBeenCalled()
      expect(nodeFs.rmSync).toHaveBeenCalledWith('/project/.agents/skills/test-skill', {
        recursive: true,
        force: true,
      })
    })

    it('adds the failed package to skipped with the error message', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      manifest = createManifest({
        packages: {
          'test-skill': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/skills/test-skill' },
          }),
        },
      })
      lockfile = createLockfile({
        packages: {
          'test-skill': {
            source: { type: 'local', path: '/project/.claude/skills/test-skill' },
            integrity: 'sha256-test',
            agents: ['claude-code'],
          },
        },
      })
      vi.mocked(nodeFs.existsSync).mockImplementation(
        (path) => String(path) === '/project/.claude/skills/test-skill'
      )
      vi.mocked(canonicalModule.createAgentSymlinks).mockImplementation(() => {
        throw new Error('EACCES: permission denied')
      })

      await migrateSkills(undefined, { yes: true })

      const emitted = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        migrated: Array<{ name: string; from: string; to: string }>
        skipped: Array<{ name: string; reason: string }>
      }

      expect(emitted.skipped).toHaveLength(1)
      expect(emitted.skipped[0]!.reason).toContain('EACCES')
      expect(emitted.migrated).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // New tests: Confirmation prompt in non-JSON mode
  // -------------------------------------------------------------------------

  describe('confirmation prompt', () => {
    it('prompts the user in non-JSON mode without --yes', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      manifest = createManifest({
        packages: {
          'test-skill': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/skills/test-skill' },
          }),
        },
      })
      lockfile = createLockfile({
        packages: {
          'test-skill': {
            source: { type: 'local', path: '/project/.claude/skills/test-skill' },
            integrity: 'sha256-test',
            agents: ['claude-code'],
          },
        },
      })
      vi.mocked(nodeFs.existsSync).mockImplementation(
        (path) => String(path) === '/project/.claude/skills/test-skill'
      )

      // User accepts the prompt
      vi.mocked(promptsFn).mockResolvedValue({ proceed: true })

      await migrateSkills(undefined, {})

      expect(promptsFn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'confirm',
          name: 'proceed',
        })
      )
      expect(nodeFs.cpSync).toHaveBeenCalled()
    })

    it('cancels migration when user declines the prompt', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      manifest = createManifest({
        packages: {
          'test-skill': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/skills/test-skill' },
          }),
        },
      })
      lockfile = createLockfile({
        packages: {
          'test-skill': {
            source: { type: 'local', path: '/project/.claude/skills/test-skill' },
            integrity: 'sha256-test',
            agents: ['claude-code'],
          },
        },
      })
      vi.mocked(nodeFs.existsSync).mockImplementation(
        (path) => String(path) === '/project/.claude/skills/test-skill'
      )

      // User declines the prompt
      vi.mocked(promptsFn).mockResolvedValue({ proceed: false })

      await migrateSkills(undefined, {})

      // Migration should be cancelled — no file operations, exits with CANCELLED
      expect(nodeFs.cpSync).not.toHaveBeenCalled()
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('skips prompt when --yes is passed in non-JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
      manifest = createManifest({
        packages: {
          'test-skill': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/skills/test-skill' },
          }),
        },
      })
      lockfile = createLockfile({
        packages: {
          'test-skill': {
            source: { type: 'local', path: '/project/.claude/skills/test-skill' },
            integrity: 'sha256-test',
            agents: ['claude-code'],
          },
        },
      })
      vi.mocked(nodeFs.existsSync).mockImplementation(
        (path) => String(path) === '/project/.claude/skills/test-skill'
      )

      await migrateSkills(undefined, { yes: true })

      expect(promptsFn).not.toHaveBeenCalled()
      expect(nodeFs.cpSync).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // New tests: Package with multiple agents (symlinks for all)
  // -------------------------------------------------------------------------

  describe('package with multiple agents', () => {
    it('creates symlinks for every agent listed in the manifest', async () => {
      manifest = createManifest({
        packages: {
          'test-skill': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/skills/test-skill' },
            agents: ['claude-code', 'cursor', 'windsurf'],
          }),
        },
      })
      lockfile = createLockfile({
        packages: {
          'test-skill': {
            source: { type: 'local', path: '/project/.claude/skills/test-skill' },
            integrity: 'sha256-test',
            agents: ['claude-code', 'cursor', 'windsurf'],
          },
        },
      })
      vi.mocked(nodeFs.existsSync).mockImplementation(
        (path) => String(path) === '/project/.claude/skills/test-skill'
      )

      await migrateSkills(undefined, { yes: true })

      expect(canonicalModule.createAgentSymlinks).toHaveBeenCalledWith(
        '/project',
        'test-skill',
        ['claude-code', 'cursor', 'windsurf'],
        'project'
      )
    })
  })

  // -------------------------------------------------------------------------
  // New tests: Filtering by name
  // -------------------------------------------------------------------------

  describe('filtering by package name', () => {
    it('migrates only the named package', async () => {
      manifest = createManifest({
        packages: {
          'skill-a': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/skills/skill-a' },
            agents: ['claude-code'],
          }),
          'skill-b': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/skills/skill-b' },
            agents: ['claude-code'],
          }),
        },
      })
      lockfile = createLockfile({
        packages: {
          'skill-a': {
            source: { type: 'local', path: '/project/.claude/skills/skill-a' },
            integrity: 'sha256-a',
            agents: ['claude-code'],
          },
          'skill-b': {
            source: { type: 'local', path: '/project/.claude/skills/skill-b' },
            integrity: 'sha256-b',
            agents: ['claude-code'],
          },
        },
      })

      vi.mocked(canonicalModule.getCanonicalSkillPath).mockImplementation(
        (_root, name) => `/project/.agents/skills/${name}`
      )
      vi.mocked(canonicalModule.resolveReadPath).mockImplementation(
        (_root, name) => `/project/.claude/skills/${name}`
      )
      vi.mocked(nodeFs.existsSync).mockImplementation((path) => {
        const pathStr = String(path)
        return (
          pathStr === '/project/.claude/skills/skill-a' ||
          pathStr === '/project/.claude/skills/skill-b'
        )
      })

      await migrateSkills('skill-a', { yes: true })

      // Only skill-a should be migrated
      expect(nodeFs.cpSync).toHaveBeenCalledTimes(1)
      expect(nodeFs.cpSync).toHaveBeenCalledWith(
        '/project/.claude/skills/skill-a',
        '/project/.agents/skills/skill-a',
        expect.objectContaining({ recursive: true })
      )
    })

    it('exits with NOT_FOUND when the named package is not installed', async () => {
      manifest = createManifest({ packages: {} })

      await migrateSkills('nonexistent', { yes: true })

      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // New tests: Non-skill package types are skipped
  // -------------------------------------------------------------------------

  describe('non-skill package types', () => {
    it('skips non-migratable package types with a descriptive reason', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      manifest = createManifest({
        packages: {
          'test-plugin': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/plugins/test-plugin' },
            packageType: 'PLUGIN',
          }),
        },
      })

      await migrateSkills(undefined, { yes: true })

      const emitted = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        migrated: Array<{ name: string }>
        skipped: Array<{ name: string; reason: string }>
      }

      expect(emitted.migrated).toHaveLength(0)
      expect(emitted.skipped).toHaveLength(1)
      expect(emitted.skipped[0]!.reason).toContain('PLUGIN')
    })

    it('migrates an AGENT single-file package using copyFileSync and createFileSymlinks', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      manifest = createManifest({
        packages: {
          'test-agent': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/agents' },
            packageType: 'AGENT',
            agents: ['claude-code'],
          }),
        },
      })
      lockfile = createLockfile({
        packages: {
          'test-agent': {
            source: { type: 'local', path: '/project/.claude/agents' },
            integrity: 'sha256-agent',
            agents: ['claude-code'],
          },
        },
      })

      vi.mocked(canonicalModule.getCanonicalFilePath).mockReturnValue(
        '/project/.agents/agents/test-agent.md'
      )
      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/project/.claude/agents/test-agent.md'
      )
      vi.mocked(nodeFs.existsSync).mockImplementation(
        (path) => String(path) === '/project/.claude/agents/test-agent.md'
      )

      await migrateSkills(undefined, { yes: true })

      // Single-file migration uses copyFileSync + unlinkSync, NOT cpSync + rmSync
      expect(nodeFs.copyFileSync).toHaveBeenCalledWith(
        '/project/.claude/agents/test-agent.md',
        '/project/.agents/agents/test-agent.md'
      )
      expect(nodeFs.unlinkSync).toHaveBeenCalledWith('/project/.claude/agents/test-agent.md')
      expect(nodeFs.cpSync).not.toHaveBeenCalled()
      expect(nodeFs.rmSync).not.toHaveBeenCalled()

      // Uses createFileSymlinks, NOT createAgentSymlinks
      expect(canonicalModule.createFileSymlinks).toHaveBeenCalledWith(
        '/project',
        'test-agent',
        'agents',
        ['claude-code'],
        'project'
      )
      expect(canonicalModule.createAgentSymlinks).not.toHaveBeenCalled()

      // JSON output includes the migrated entry
      const emitted = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        migrated: Array<{ name: string; from: string; to: string }>
        skipped: Array<{ name: string; reason: string }>
      }
      expect(emitted.migrated).toHaveLength(1)
      expect(emitted.migrated[0]).toEqual({
        name: 'test-agent',
        from: '/project/.claude/agents/test-agent.md',
        to: '/project/.agents/agents/test-agent.md',
      })
      expect(emitted.skipped).toHaveLength(0)
    })

    it('migrates a COMMAND single-file package using copyFileSync and createFileSymlinks', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      manifest = createManifest({
        packages: {
          'test-command': createManifestPackage({
            source: { type: 'local', path: '/project/.claude/commands' },
            packageType: 'COMMAND',
            agents: ['claude-code'],
          }),
        },
      })
      lockfile = createLockfile({
        packages: {
          'test-command': {
            source: { type: 'local', path: '/project/.claude/commands' },
            integrity: 'sha256-cmd',
            agents: ['claude-code'],
          },
        },
      })

      vi.mocked(canonicalModule.getCanonicalFilePath).mockReturnValue(
        '/project/.agents/commands/test-command.md'
      )
      vi.mocked(canonicalModule.resolveReadPath).mockReturnValue(
        '/project/.claude/commands/test-command.md'
      )
      vi.mocked(nodeFs.existsSync).mockImplementation(
        (path) => String(path) === '/project/.claude/commands/test-command.md'
      )

      await migrateSkills(undefined, { yes: true })

      // Single-file migration uses copyFileSync + unlinkSync
      expect(nodeFs.copyFileSync).toHaveBeenCalledWith(
        '/project/.claude/commands/test-command.md',
        '/project/.agents/commands/test-command.md'
      )
      expect(nodeFs.unlinkSync).toHaveBeenCalledWith('/project/.claude/commands/test-command.md')
      expect(nodeFs.cpSync).not.toHaveBeenCalled()
      expect(nodeFs.rmSync).not.toHaveBeenCalled()

      // Uses createFileSymlinks with 'commands' category
      expect(canonicalModule.createFileSymlinks).toHaveBeenCalledWith(
        '/project',
        'test-command',
        'commands',
        ['claude-code'],
        'project'
      )
      expect(canonicalModule.createAgentSymlinks).not.toHaveBeenCalled()

      // JSON output includes the migrated entry
      const emitted = vi.mocked(outputModule.outputSuccess).mock.calls[0]![0] as {
        migrated: Array<{ name: string; from: string; to: string }>
        skipped: Array<{ name: string; reason: string }>
      }
      expect(emitted.migrated).toHaveLength(1)
      expect(emitted.migrated[0]).toEqual({
        name: 'test-command',
        from: '/project/.claude/commands/test-command.md',
        to: '/project/.agents/commands/test-command.md',
      })
    })
  })
})
