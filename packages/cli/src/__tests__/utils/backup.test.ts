import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn(),
  cpSync: vi.fn(),
  rmSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
}))

vi.mock('../../storage/manifest', () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile', () => ({
  readLockfile: vi.fn(),
  writeLockfile: vi.fn(),
}))

vi.mock('@agentver/shared', async () => {
  const actual = await vi.importActual<typeof import('@agentver/shared')>('@agentver/shared')
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }
})

describe('utils/backup', () => {
  let fs: typeof import('node:fs')
  let backupModule: typeof import('../../utils/backup')
  let manifestModule: typeof import('../../storage/manifest')
  let lockfileModule: typeof import('../../storage/lockfile')

  beforeEach(async () => {
    vi.clearAllMocks()
    fs = await import('node:fs')
    backupModule = await import('../../utils/backup')
    manifestModule = await import('../../storage/manifest')
    lockfileModule = await import('../../storage/lockfile')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createBackup', () => {
    it('creates a backup state with manifest and lockfile entries', () => {
      vi.mocked(fs.mkdtempSync).mockReturnValue('/tmp/agentver-backup-123')
      vi.mocked(manifestModule.readManifest).mockReturnValue({
        version: 2,
        packages: {
          'my-skill': {
            source: { type: 'git', uri: 'test', path: '', ref: 'main', commit: 'abc' },
            agents: ['claude'],
            installedAt: '2024-01-01T00:00:00.000Z',
            modified: false,
          },
        },
      })
      vi.mocked(lockfileModule.readLockfile).mockReturnValue({
        version: 2,
        packages: {
          'my-skill': {
            source: { type: 'git', uri: 'test', path: '', ref: 'main', commit: 'abc' },
            integrity: 'sha256-test',
            agents: ['claude'],
          },
        },
      })
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const backup = backupModule.createBackup('my-skill', '/project', null)

      expect(backup.packageName).toBe('my-skill')
      expect(backup.projectRoot).toBe('/project')
      expect(backup.tempDir).toBe('/tmp/agentver-backup-123')
      expect(backup.manifestEntry).toBeDefined()
      expect(backup.lockfileEntry).toBeDefined()
    })

    it('copies skill directory to backup when it exists', () => {
      vi.mocked(fs.mkdtempSync).mockReturnValue('/tmp/agentver-backup-123')
      vi.mocked(manifestModule.readManifest).mockReturnValue({ version: 2, packages: {} })
      vi.mocked(lockfileModule.readLockfile).mockReturnValue({ version: 2, packages: {} })
      vi.mocked(fs.existsSync).mockReturnValue(true)

      backupModule.createBackup('my-skill', '/project', '/project/.agents/skills/my-skill')

      expect(fs.cpSync).toHaveBeenCalledWith(
        '/project/.agents/skills/my-skill',
        '/tmp/agentver-backup-123/files',
        { recursive: true }
      )
    })

    it('handles missing package entries gracefully', () => {
      vi.mocked(fs.mkdtempSync).mockReturnValue('/tmp/agentver-backup-123')
      vi.mocked(manifestModule.readManifest).mockReturnValue({ version: 2, packages: {} })
      vi.mocked(lockfileModule.readLockfile).mockReturnValue({ version: 2, packages: {} })
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const backup = backupModule.createBackup('missing-skill', '/project', null)

      expect(backup.manifestEntry).toBeNull()
      expect(backup.lockfileEntry).toBeNull()
    })
  })

  describe('restoreBackup', () => {
    it('restores manifest and lockfile entries', () => {
      const manifestEntry = {
        source: { type: 'git' as const, uri: 'test', path: '', ref: 'main', commit: 'abc' },
        agents: ['claude'],
        installedAt: '2024-01-01T00:00:00.000Z',
        modified: false,
      }
      const lockfileEntry = {
        source: { type: 'git' as const, uri: 'test', path: '', ref: 'main', commit: 'abc' },
        integrity: 'sha256-test',
        agents: ['claude'],
      }

      vi.mocked(manifestModule.readManifest).mockReturnValue({ version: 2, packages: {} })
      vi.mocked(lockfileModule.readLockfile).mockReturnValue({ version: 2, packages: {} })
      vi.mocked(fs.existsSync).mockReturnValue(false)

      backupModule.restoreBackup({
        packageName: 'my-skill',
        projectRoot: '/project',
        tempDir: '/tmp/backup',
        skillDir: null,
        manifestEntry,
        lockfileEntry,
      })

      expect(manifestModule.writeManifest).toHaveBeenCalled()
      expect(lockfileModule.writeLockfile).toHaveBeenCalled()
    })

    it('restores the original manifest entry, not a new one', () => {
      const originalEntry = {
        source: {
          type: 'git' as const,
          uri: 'original',
          path: '',
          ref: 'v1.0',
          commit: 'original-sha',
        },
        agents: ['claude'],
        installedAt: '2024-01-01T00:00:00.000Z',
        modified: false,
      }

      // Simulate post-failed-install state: manifest has a partial new entry
      vi.mocked(manifestModule.readManifest).mockReturnValue({
        version: 2,
        packages: {
          'my-skill': {
            source: { type: 'git', uri: 'new-broken', path: '', ref: 'main', commit: 'broken-sha' },
            agents: ['claude'],
            installedAt: '2024-06-01T00:00:00.000Z',
            modified: false,
          },
        },
      })
      vi.mocked(lockfileModule.readLockfile).mockReturnValue({ version: 2, packages: {} })
      vi.mocked(fs.existsSync).mockReturnValue(false)

      backupModule.restoreBackup({
        packageName: 'my-skill',
        projectRoot: '/project',
        tempDir: '/tmp/backup',
        skillDir: null,
        manifestEntry: originalEntry,
        lockfileEntry: null,
      })

      const writtenManifest = vi.mocked(manifestModule.writeManifest).mock.calls[0]![1]
      const source = writtenManifest.packages['my-skill']!.source
      expect(source.type).toBe('git')
      if (source.type === 'git') {
        expect(source.commit).toBe('original-sha')
      }
    })

    it('removes the package from manifest when backup had no entry (new install rollback)', () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue({
        version: 2,
        packages: {
          'my-skill': {
            source: { type: 'git', uri: 'test', path: '', ref: 'main', commit: 'abc' },
            agents: ['claude'],
            installedAt: '2024-01-01T00:00:00.000Z',
            modified: false,
          },
        },
      })
      vi.mocked(lockfileModule.readLockfile).mockReturnValue({ version: 2, packages: {} })
      vi.mocked(fs.existsSync).mockReturnValue(false)

      backupModule.restoreBackup({
        packageName: 'my-skill',
        projectRoot: '/project',
        tempDir: '/tmp/backup',
        skillDir: null,
        manifestEntry: null,
        lockfileEntry: null,
      })

      const writtenManifest = vi.mocked(manifestModule.writeManifest).mock.calls[0]![1]
      expect(writtenManifest.packages['my-skill']).toBeUndefined()
    })

    it('restores skill files from backup', () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue({ version: 2, packages: {} })
      vi.mocked(lockfileModule.readLockfile).mockReturnValue({ version: 2, packages: {} })
      vi.mocked(fs.existsSync).mockReturnValue(true)

      backupModule.restoreBackup({
        packageName: 'my-skill',
        projectRoot: '/project',
        tempDir: '/tmp/backup',
        skillDir: '/project/.agents/skills/my-skill',
        manifestEntry: null,
        lockfileEntry: null,
      })

      expect(fs.rmSync).toHaveBeenCalled()
      expect(fs.mkdirSync).toHaveBeenCalled()
      expect(fs.cpSync).toHaveBeenCalled()
    })
  })

  describe('cleanupBackup', () => {
    it('removes the temp backup directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      backupModule.cleanupBackup({
        packageName: 'my-skill',
        projectRoot: '/project',
        tempDir: '/tmp/backup-123',
        skillDir: null,
        manifestEntry: null,
        lockfileEntry: null,
      })

      expect(fs.rmSync).toHaveBeenCalledWith('/tmp/backup-123', { recursive: true, force: true })
    })

    it('does nothing when temp dir does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      backupModule.cleanupBackup({
        packageName: 'my-skill',
        projectRoot: '/project',
        tempDir: '/tmp/nonexistent',
        skillDir: null,
        manifestEntry: null,
        lockfileEntry: null,
      })

      expect(fs.rmSync).not.toHaveBeenCalled()
    })
  })
})
