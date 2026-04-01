import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue('/home/testuser'),
  }
})

import {
  cleanupExpiredBackups,
  createPersistentBackup,
  deleteBackup,
  getBackupStorageSize,
  listBackups,
  readBackupIndex,
  restorePersistentBackup,
} from '../persistent-backup'

describe('persistent-backup', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentver-pb-test-'))
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe('readBackupIndex', () => {
    it('returns an empty index when no backups exist', () => {
      const index = readBackupIndex(tmpDir, 'project')
      expect(index).toEqual({ version: 1, entries: [] })
    })

    it('reads an existing index', () => {
      const backupsDir = join(tmpDir, '.agentver', 'backups')
      mkdirSync(backupsDir, { recursive: true })
      writeFileSync(
        join(backupsDir, 'index.json'),
        JSON.stringify({
          version: 1,
          entries: [
            {
              id: 'test-1',
              createdAt: '2026-01-01T00:00:00.000Z',
              packageKey: 'git:test',
              displayName: 'test-skill',
              reason: 'conflict-replace',
              items: [],
            },
          ],
        })
      )

      const index = readBackupIndex(tmpDir, 'project')
      expect(index.entries).toHaveLength(1)
      expect(index.entries[0]?.id).toBe('test-1')
    })
  })

  describe('createPersistentBackup', () => {
    it('creates a backup of a single file', () => {
      const filePath = join(tmpDir, 'some-file.md')
      writeFileSync(filePath, 'original content', 'utf-8')

      const handle = createPersistentBackup(
        tmpDir,
        'project',
        'git:test',
        'test-skill',
        [filePath],
        'conflict-replace'
      )

      expect(handle.id).toBeTruthy()
      expect(handle.entry.items).toHaveLength(1)
      expect(handle.entry.items[0]?.kind).toBe('file')
      expect(handle.entry.items[0]?.size).toBeGreaterThan(0)

      // Verify the backup file exists
      const backupFile = join(handle.backupDir, 'items', 'target-0')
      expect(existsSync(backupFile)).toBe(true)
      expect(readFileSync(backupFile, 'utf-8')).toBe('original content')
    })

    it('creates a backup of a directory', () => {
      const dirPath = join(tmpDir, 'skill-dir')
      mkdirSync(dirPath, { recursive: true })
      writeFileSync(join(dirPath, 'SKILL.md'), '# Skill', 'utf-8')
      writeFileSync(join(dirPath, 'helper.ts'), 'export {}', 'utf-8')

      const handle = createPersistentBackup(
        tmpDir,
        'project',
        'git:test',
        'my-skill',
        [dirPath],
        'conflict-replace'
      )

      expect(handle.entry.items).toHaveLength(1)
      expect(handle.entry.items[0]?.kind).toBe('directory')

      const backupDir = join(handle.backupDir, 'items', 'target-0')
      expect(existsSync(join(backupDir, 'SKILL.md'))).toBe(true)
      expect(existsSync(join(backupDir, 'helper.ts'))).toBe(true)
    })

    it('persists the backup entry in the index', () => {
      const filePath = join(tmpDir, 'file.md')
      writeFileSync(filePath, 'data', 'utf-8')

      createPersistentBackup(tmpDir, 'project', 'git:test', 'test-skill', [filePath], 'manual')

      const index = readBackupIndex(tmpDir, 'project')
      expect(index.entries).toHaveLength(1)
      expect(index.entries[0]?.reason).toBe('manual')
      expect(index.entries[0]?.displayName).toBe('test-skill')
    })

    it('stores manifest and lockfile entries when provided', () => {
      const filePath = join(tmpDir, 'file.md')
      writeFileSync(filePath, 'data', 'utf-8')

      const manifestEntry = { name: 'test', source: { type: 'git' as const }, agents: [] }
      const lockfileEntry = { name: 'test', integrity: 'sha256-abc' }

      const handle = createPersistentBackup(
        tmpDir,
        'project',
        'git:test',
        'test-skill',
        [filePath],
        'update-replace',
        manifestEntry,
        lockfileEntry
      )

      expect(handle.entry.manifestEntry).toEqual(manifestEntry)
      expect(handle.entry.lockfileEntry).toEqual(lockfileEntry)
    })

    it('skips non-existent paths', () => {
      const missing = join(tmpDir, 'does-not-exist.md')

      const handle = createPersistentBackup(
        tmpDir,
        'project',
        'git:test',
        'test',
        [missing],
        'conflict-replace'
      )

      expect(handle.entry.items).toHaveLength(0)
    })

    it('de-duplicates paths', () => {
      const filePath = join(tmpDir, 'dup.md')
      writeFileSync(filePath, 'content', 'utf-8')

      const handle = createPersistentBackup(
        tmpDir,
        'project',
        'git:test',
        'test',
        [filePath, filePath],
        'conflict-replace'
      )

      expect(handle.entry.items).toHaveLength(1)
    })

    it('creates multiple backups with unique IDs', () => {
      const filePath = join(tmpDir, 'file.md')
      writeFileSync(filePath, 'data', 'utf-8')

      const handle1 = createPersistentBackup(
        tmpDir,
        'project',
        'git:test',
        'skill-1',
        [filePath],
        'conflict-replace'
      )

      const handle2 = createPersistentBackup(
        tmpDir,
        'project',
        'git:test',
        'skill-2',
        [filePath],
        'conflict-replace'
      )

      expect(handle1.id).not.toBe(handle2.id)

      const index = readBackupIndex(tmpDir, 'project')
      expect(index.entries).toHaveLength(2)
    })
  })

  describe('restorePersistentBackup', () => {
    it('restores a file to its original location', () => {
      const filePath = join(tmpDir, 'restore-me.md')
      writeFileSync(filePath, 'original', 'utf-8')

      const handle = createPersistentBackup(
        tmpDir,
        'project',
        'git:test',
        'test',
        [filePath],
        'conflict-replace'
      )

      // Overwrite the original
      writeFileSync(filePath, 'overwritten', 'utf-8')

      const restored = restorePersistentBackup(tmpDir, 'project', handle.id)

      expect(readFileSync(filePath, 'utf-8')).toBe('original')
      expect(restored).toEqual([filePath])
    })

    it('restores a directory', () => {
      const dirPath = join(tmpDir, 'skill-dir')
      mkdirSync(dirPath, { recursive: true })
      writeFileSync(join(dirPath, 'SKILL.md'), '# Original', 'utf-8')

      const handle = createPersistentBackup(
        tmpDir,
        'project',
        'git:test',
        'test',
        [dirPath],
        'conflict-replace'
      )

      // Remove and replace
      rmSync(dirPath, { recursive: true, force: true })
      mkdirSync(dirPath, { recursive: true })
      writeFileSync(join(dirPath, 'SKILL.md'), '# New', 'utf-8')

      restorePersistentBackup(tmpDir, 'project', handle.id)

      expect(readFileSync(join(dirPath, 'SKILL.md'), 'utf-8')).toBe('# Original')
    })

    it('creates parent directories if they were deleted', () => {
      const nestedPath = join(tmpDir, 'deep', 'nested', 'file.md')
      mkdirSync(join(tmpDir, 'deep', 'nested'), { recursive: true })
      writeFileSync(nestedPath, 'deep content', 'utf-8')

      const handle = createPersistentBackup(
        tmpDir,
        'project',
        'git:test',
        'test',
        [nestedPath],
        'conflict-replace'
      )

      rmSync(join(tmpDir, 'deep'), { recursive: true, force: true })

      restorePersistentBackup(tmpDir, 'project', handle.id)

      expect(readFileSync(nestedPath, 'utf-8')).toBe('deep content')
    })

    it('throws when backup ID is not found', () => {
      expect(() => restorePersistentBackup(tmpDir, 'project', 'nonexistent')).toThrow(
        'Backup not found: nonexistent'
      )
    })
  })

  describe('listBackups', () => {
    it('returns an empty array when no backups exist', () => {
      expect(listBackups(tmpDir, 'project')).toEqual([])
    })

    it('returns all backup entries', () => {
      const filePath = join(tmpDir, 'file.md')
      writeFileSync(filePath, 'data', 'utf-8')

      createPersistentBackup(tmpDir, 'project', 'git:a', 'a', [filePath], 'conflict-replace')
      createPersistentBackup(tmpDir, 'project', 'git:b', 'b', [filePath], 'update-replace')

      const entries = listBackups(tmpDir, 'project')
      expect(entries).toHaveLength(2)
      expect(entries[0]?.displayName).toBe('a')
      expect(entries[1]?.displayName).toBe('b')
    })
  })

  describe('deleteBackup', () => {
    it('removes the backup entry and directory', () => {
      const filePath = join(tmpDir, 'file.md')
      writeFileSync(filePath, 'data', 'utf-8')

      const handle = createPersistentBackup(
        tmpDir,
        'project',
        'git:test',
        'test',
        [filePath],
        'conflict-replace'
      )

      expect(existsSync(handle.backupDir)).toBe(true)

      deleteBackup(tmpDir, 'project', handle.id)

      expect(existsSync(handle.backupDir)).toBe(false)
      expect(listBackups(tmpDir, 'project')).toHaveLength(0)
    })

    it('throws when backup ID is not found', () => {
      expect(() => deleteBackup(tmpDir, 'project', 'nonexistent')).toThrow(
        'Backup not found: nonexistent'
      )
    })

    it('removes only the specified backup', () => {
      const filePath = join(tmpDir, 'file.md')
      writeFileSync(filePath, 'data', 'utf-8')

      const handle1 = createPersistentBackup(
        tmpDir,
        'project',
        'git:a',
        'a',
        [filePath],
        'conflict-replace'
      )
      createPersistentBackup(tmpDir, 'project', 'git:b', 'b', [filePath], 'conflict-replace')

      deleteBackup(tmpDir, 'project', handle1.id)

      const remaining = listBackups(tmpDir, 'project')
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.displayName).toBe('b')
    })
  })

  describe('cleanupExpiredBackups', () => {
    it('does nothing when under the limit', () => {
      const filePath = join(tmpDir, 'file.md')
      writeFileSync(filePath, 'data', 'utf-8')

      createPersistentBackup(tmpDir, 'project', 'git:test', 'test', [filePath], 'conflict-replace')

      const removed = cleanupExpiredBackups(tmpDir, 'project', { maxCount: 5 })
      expect(removed).toBe(0)
      expect(listBackups(tmpDir, 'project')).toHaveLength(1)
    })

    it('removes oldest backups beyond the limit when they exceed retention', () => {
      const filePath = join(tmpDir, 'file.md')
      writeFileSync(filePath, 'data', 'utf-8')

      // Create 3 backups, all with old dates
      for (let i = 0; i < 3; i++) {
        createPersistentBackup(
          tmpDir,
          'project',
          `git:test-${String(i)}`,
          `test-${String(i)}`,
          [filePath],
          'conflict-replace'
        )
      }

      // Manually set old creation dates
      const index = readBackupIndex(tmpDir, 'project')
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
      for (const entry of index.entries) {
        entry.createdAt = eightDaysAgo
      }

      // Rewrite index with old dates
      const backupsDir = join(tmpDir, '.agentver', 'backups')
      writeFileSync(join(backupsDir, 'index.json'), JSON.stringify(index))

      const removed = cleanupExpiredBackups(tmpDir, 'project', { maxCount: 1, retentionDays: 7 })
      expect(removed).toBe(2)
      expect(listBackups(tmpDir, 'project')).toHaveLength(1)
    })

    it('does not remove backups within the retention period', () => {
      const filePath = join(tmpDir, 'file.md')
      writeFileSync(filePath, 'data', 'utf-8')

      for (let i = 0; i < 3; i++) {
        createPersistentBackup(
          tmpDir,
          'project',
          `git:test-${String(i)}`,
          `test-${String(i)}`,
          [filePath],
          'conflict-replace'
        )
      }

      // All backups are recent (just created), so none should be removed
      const removed = cleanupExpiredBackups(tmpDir, 'project', {
        maxCount: 1,
        retentionDays: 7,
      })
      expect(removed).toBe(0)
      expect(listBackups(tmpDir, 'project')).toHaveLength(3)
    })
  })

  describe('getBackupStorageSize', () => {
    it('returns 0 when no backups exist', () => {
      expect(getBackupStorageSize(tmpDir, 'project')).toBe(0)
    })

    it('returns the total size of all backed-up items', () => {
      const filePath = join(tmpDir, 'file.md')
      writeFileSync(filePath, 'hello world', 'utf-8')

      createPersistentBackup(tmpDir, 'project', 'git:test', 'test', [filePath], 'conflict-replace')

      const size = getBackupStorageSize(tmpDir, 'project')
      expect(size).toBe(11) // 'hello world'.length
    })
  })
})
