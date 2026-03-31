import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFilesystemBackup, restoreFilesystemBackup } from '../index'

describe('backup', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentver-backup-test-'))
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe('createFilesystemBackup', () => {
    it('copies existing paths to a temp backup directory', () => {
      const filePath = join(tmpDir, 'some-file.md')
      writeFileSync(filePath, 'original content', 'utf-8')

      const handle = createFilesystemBackup([filePath], 'conflict-replace')

      expect(existsSync(handle.backupPath)).toBe(true)
      const backedUp = readFileSync(join(handle.backupPath, 'target-0'), 'utf-8')
      expect(backedUp).toBe('original content')

      handle.cleanup()
    })

    it('copies directories recursively', () => {
      const dirPath = join(tmpDir, 'skill-dir')
      mkdirSync(dirPath, { recursive: true })
      writeFileSync(join(dirPath, 'SKILL.md'), '# Skill', 'utf-8')
      writeFileSync(join(dirPath, 'helper.ts'), 'export {}', 'utf-8')

      const handle = createFilesystemBackup([dirPath], 'conflict-replace')

      const backupDir = join(handle.backupPath, 'target-0')
      expect(existsSync(join(backupDir, 'SKILL.md'))).toBe(true)
      expect(existsSync(join(backupDir, 'helper.ts'))).toBe(true)
      expect(readFileSync(join(backupDir, 'SKILL.md'), 'utf-8')).toBe('# Skill')

      handle.cleanup()
    })

    it('returns a BackupHandle with cleanup function', () => {
      const filePath = join(tmpDir, 'to-backup.md')
      writeFileSync(filePath, 'data', 'utf-8')

      const handle = createFilesystemBackup([filePath], 'conflict-replace')

      expect(handle.id).toBeTruthy()
      expect(handle.backupPath).toBeTruthy()
      expect(handle.originalPaths).toEqual([filePath])
      expect(typeof handle.cleanup).toBe('function')

      handle.cleanup()
    })

    it('cleanup() removes the backup directory', () => {
      const filePath = join(tmpDir, 'removable.md')
      writeFileSync(filePath, 'temp', 'utf-8')

      const handle = createFilesystemBackup([filePath], 'conflict-replace')
      expect(existsSync(handle.backupPath)).toBe(true)

      handle.cleanup()
      expect(existsSync(handle.backupPath)).toBe(false)
    })

    it('skips non-existent paths without failing', () => {
      const missing = join(tmpDir, 'does-not-exist.md')

      const handle = createFilesystemBackup([missing], 'conflict-replace')

      expect(handle.originalPaths).toEqual([])
      expect(existsSync(handle.backupPath)).toBe(true)

      handle.cleanup()
    })

    it('de-duplicates paths', () => {
      const filePath = join(tmpDir, 'dup.md')
      writeFileSync(filePath, 'content', 'utf-8')

      const handle = createFilesystemBackup([filePath, filePath], 'conflict-replace')

      // Only one backup target should exist
      expect(handle.originalPaths).toEqual([filePath])
      expect(existsSync(join(handle.backupPath, 'target-0'))).toBe(true)
      expect(existsSync(join(handle.backupPath, 'target-1'))).toBe(false)

      handle.cleanup()
    })
  })

  describe('restoreFilesystemBackup', () => {
    it('restores files from backup to original locations', () => {
      const filePath = join(tmpDir, 'restore-me.md')
      writeFileSync(filePath, 'original', 'utf-8')

      const handle = createFilesystemBackup([filePath], 'conflict-replace')

      // Simulate the original being overwritten
      writeFileSync(filePath, 'overwritten', 'utf-8')

      restoreFilesystemBackup(handle)

      expect(readFileSync(filePath, 'utf-8')).toBe('original')

      handle.cleanup()
    })

    it('creates parent directories if needed', () => {
      const nestedPath = join(tmpDir, 'deep', 'nested', 'file.md')
      mkdirSync(join(tmpDir, 'deep', 'nested'), { recursive: true })
      writeFileSync(nestedPath, 'deep content', 'utf-8')

      const handle = createFilesystemBackup([nestedPath], 'conflict-replace')

      // Remove the entire parent chain
      rmSync(join(tmpDir, 'deep'), { recursive: true, force: true })
      expect(existsSync(nestedPath)).toBe(false)

      restoreFilesystemBackup(handle)

      expect(existsSync(nestedPath)).toBe(true)
      expect(readFileSync(nestedPath, 'utf-8')).toBe('deep content')

      handle.cleanup()
    })

    it('does nothing when backup path no longer exists', () => {
      const filePath = join(tmpDir, 'gone.md')
      writeFileSync(filePath, 'data', 'utf-8')

      const handle = createFilesystemBackup([filePath], 'conflict-replace')

      // Remove the backup manually
      rmSync(handle.backupPath, { recursive: true, force: true })

      // Should not throw
      expect(() => restoreFilesystemBackup(handle)).not.toThrow()
    })
  })
})
