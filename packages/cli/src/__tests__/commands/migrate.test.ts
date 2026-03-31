import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLockfile, createManifest, createManifestPackage } from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

vi.mock('node:fs', () => ({
  cpSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn().mockReturnValue('/tmp/agentver-migrate-backup'),
  rmSync: vi.fn(),
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
  findAgentSkillPlacementConflicts: vi.fn().mockReturnValue([]),
  getCanonicalSkillPath: vi.fn(),
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
    vi.mocked(agentDefs.getSkillPlacementPath).mockReturnValue('.claude/skills/test-skill')
    vi.mocked(nodeFs.existsSync).mockImplementation(
      (path) =>
        String(path) === '/project/.claude/skills/test-skill' ||
        String(path) === '/tmp/agentver-migrate-backup/target-0'
    )
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.exit = originalExit
  })

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
            type: 'git',
            uri: 'local',
            path: '/project/.claude/skills/test-skill',
            ref: 'local',
            commit: 'adopted',
          },
        }),
      },
    })
    lockfile = createLockfile({
      packages: {
        'test-skill': {
          source: {
            type: 'git',
            uri: 'local',
            path: '/project/.claude/skills/test-skill',
            ref: 'local',
            commit: 'adopted',
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
    expect(manifest.packages['test-skill']?.source.type).toBe('git')
    if (manifest.packages['test-skill']?.source.type === 'git') {
      expect(manifest.packages['test-skill'].source.path).toBe('/project/.agents/skills/test-skill')
    }
    expect(lockfile.packages['test-skill']?.source.type).toBe('git')
    if (lockfile.packages['test-skill']?.source.type === 'git') {
      expect(lockfile.packages['test-skill'].source.path).toBe('/project/.agents/skills/test-skill')
    }
  })

  it('restores the original filesystem when symlink creation fails', async () => {
    manifest = createManifest({
      packages: {
        'test-skill': createManifestPackage({
          source: {
            type: 'git',
            uri: 'local',
            path: '/project/.claude/skills/test-skill',
            ref: 'local',
            commit: 'adopted',
          },
        }),
      },
    })
    lockfile = createLockfile({
      packages: {
        'test-skill': {
          source: {
            type: 'git',
            uri: 'local',
            path: '/project/.claude/skills/test-skill',
            ref: 'local',
            commit: 'adopted',
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
            type: 'git',
            uri: 'local',
            path: '/project/.claude/skills/test-skill',
            ref: 'local',
            commit: 'adopted',
          },
        }),
      },
    })
    lockfile = createLockfile({
      packages: {
        'test-skill': {
          source: {
            type: 'git',
            uri: 'local',
            path: '/project/.claude/skills/test-skill',
            ref: 'local',
            commit: 'adopted',
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
})
