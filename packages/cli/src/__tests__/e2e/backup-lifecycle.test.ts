import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSkillMd } from '../helpers/fixtures'
import { withTempDir } from '../helpers/mock-fs'
import { runCliJson } from './helpers'

/**
 * Output shape for `backup list --json`.
 */
type BackupListOutput = {
  backups: Array<{
    id: string
    createdAt: string
    packageKey: string
    displayName: string
    reason: string
    items: Array<{
      originalPath: string
      backupRelativePath: string
      kind: 'file' | 'directory'
      size: number
    }>
  }>
}

/**
 * Output shape for `backup restore --json --yes`.
 */
type BackupRestoreOutput = {
  restored: boolean
  backupId: string
  paths: string[]
}

/**
 * Output shape for `backup delete --json --yes`.
 */
type BackupDeleteOutput = {
  deleted: boolean
  backupId: string
}

/**
 * Seeds a backup directly on disk — both the index entry and the
 * actual backup file(s) — so we can test list/restore/delete
 * without needing a full install flow.
 */
function seedBackup(
  projectRoot: string,
  options: {
    id: string
    packageKey?: string
    displayName?: string
    reason?: string
    files: Array<{ originalPath: string; content: string }>
  }
): void {
  const backupsRoot = join(projectRoot, '.agentver', 'backups')
  const indexPath = join(backupsRoot, 'index.json')
  const itemsDir = join(backupsRoot, options.id, 'items')

  mkdirSync(itemsDir, { recursive: true })

  const items: Array<{
    originalPath: string
    backupRelativePath: string
    kind: 'file' | 'directory'
    size: number
  }> = []

  for (const [i, file] of options.files.entries()) {
    const backupRelativePath = `target-${String(i)}`
    const backupPath = join(itemsDir, backupRelativePath)
    writeFileSync(backupPath, file.content)

    items.push({
      originalPath: file.originalPath,
      backupRelativePath,
      kind: 'file',
      size: Buffer.byteLength(file.content),
    })
  }

  const entry = {
    id: options.id,
    createdAt: new Date().toISOString(),
    packageKey: options.packageKey ?? 'test-org/test-skill',
    displayName: options.displayName ?? 'test-skill',
    reason: options.reason ?? 'conflict-replace',
    items,
  }

  // Read existing index or create a fresh one
  let index: { version: 1; entries: (typeof entry)[] } = { version: 1, entries: [] }

  if (existsSync(indexPath)) {
    try {
      index = JSON.parse(readFileSync(indexPath, 'utf-8'))
    } catch {
      // Start fresh on corrupt index
    }
  }

  index.entries.push(entry)
  mkdirSync(backupsRoot, { recursive: true })
  writeFileSync(indexPath, JSON.stringify(index, null, 2))
}

describe('E2E: backup lifecycle', () => {
  it('backup list shows empty state with no backups', async () => {
    await withTempDir(async (dir) => {
      const { data, success } = await runCliJson<BackupListOutput>(['backup', 'list', '--json'], {
        cwd: dir,
      })

      expect(success).toBe(true)
      expect(data.backups).toEqual([])
    })
  })

  it('backup list shows backups after manual creation', async () => {
    await withTempDir(async (dir) => {
      const originalPath = join(dir, 'some-agent', 'SKILL.md')
      const content = createSkillMd({ name: 'seeded-skill' })

      seedBackup(dir, {
        id: 'backup-001',
        packageKey: 'test-org/seeded-skill',
        displayName: 'seeded-skill',
        files: [{ originalPath, content }],
      })

      const { data, success } = await runCliJson<BackupListOutput>(['backup', 'list', '--json'], {
        cwd: dir,
      })

      expect(success).toBe(true)
      expect(data.backups).toHaveLength(1)

      const backup = data.backups[0]
      expect(backup).toBeDefined()
      if (!backup) return

      expect(backup.id).toBe('backup-001')
      expect(backup.displayName).toBe('seeded-skill')
      expect(backup.packageKey).toBe('test-org/seeded-skill')
      expect(backup.reason).toBe('conflict-replace')
      expect(backup.items).toHaveLength(1)

      const item = backup.items[0]
      expect(item).toBeDefined()
      if (!item) return

      expect(item.originalPath).toBe(originalPath)
      expect(item.kind).toBe('file')
      expect(item.size).toBeGreaterThan(0)
    })
  })

  it('backup restore restores files to their original locations', async () => {
    await withTempDir(async (dir) => {
      const restoredDir = join(dir, 'restored-target')
      mkdirSync(restoredDir, { recursive: true })

      const originalPath = join(restoredDir, 'SKILL.md')
      const backedUpContent = '# Original content before overwrite\n'

      // Write a different file at the original path to simulate post-install state
      writeFileSync(originalPath, '# Overwritten by install\n')

      // Seed the backup with the original content
      seedBackup(dir, {
        id: 'backup-restore-test',
        files: [{ originalPath, content: backedUpContent }],
      })

      const { data, success } = await runCliJson<BackupRestoreOutput>(
        ['backup', 'restore', 'backup-restore-test', '--yes', '--json'],
        { cwd: dir }
      )

      expect(success).toBe(true)
      expect(data.restored).toBe(true)
      expect(data.backupId).toBe('backup-restore-test')
      expect(data.paths).toContain(originalPath)

      // Verify the file on disk has the original backed-up content
      const restoredContent = readFileSync(originalPath, 'utf-8')
      expect(restoredContent).toBe(backedUpContent)
    })
  })

  it('backup restore fails for non-existent backup ID', async () => {
    await withTempDir(async (dir) => {
      const { success, exitCode } = await runCliJson<unknown>(
        ['backup', 'restore', 'nonexistent', '--yes', '--json'],
        { cwd: dir }
      )

      expect(success).toBe(false)
      expect(exitCode).not.toBe(0)
    })
  })

  it('backup delete removes the backup', async () => {
    await withTempDir(async (dir) => {
      const originalPath = join(dir, 'some-agent', 'SKILL.md')
      const content = createSkillMd()

      seedBackup(dir, {
        id: 'backup-to-delete',
        files: [{ originalPath, content }],
      })

      // Confirm the backup exists first
      const listBefore = await runCliJson<BackupListOutput>(['backup', 'list', '--json'], {
        cwd: dir,
      })
      expect(listBefore.data.backups).toHaveLength(1)

      // Delete it
      const { data, success } = await runCliJson<BackupDeleteOutput>(
        ['backup', 'delete', 'backup-to-delete', '--yes', '--json'],
        { cwd: dir }
      )

      expect(success).toBe(true)
      expect(data.deleted).toBe(true)
      expect(data.backupId).toBe('backup-to-delete')

      // Confirm it is gone
      const listAfter = await runCliJson<BackupListOutput>(['backup', 'list', '--json'], {
        cwd: dir,
      })
      expect(listAfter.data.backups).toHaveLength(0)

      // Confirm the backup directory is also removed from disk
      const backupDir = join(dir, '.agentver', 'backups', 'backup-to-delete')
      expect(existsSync(backupDir)).toBe(false)
    })
  })

  it('backup delete fails for non-existent backup ID', async () => {
    await withTempDir(async (dir) => {
      const { success, exitCode } = await runCliJson<unknown>(
        ['backup', 'delete', 'nonexistent', '--yes', '--json'],
        { cwd: dir }
      )

      expect(success).toBe(false)
      expect(exitCode).not.toBe(0)
    })
  })
})
