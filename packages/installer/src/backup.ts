import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { BackupHandle } from './types'

/**
 * Creates a filesystem backup of the given paths.
 *
 * Files and directories are copied to a temporary directory, preserving
 * symlink structure (no dereference). The returned BackupHandle contains
 * a cleanup function to remove the backup once the operation is confirmed.
 */
export function createFilesystemBackup(paths: string[], _reason: string): BackupHandle {
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const tempDir = mkdtempSync(join(tmpdir(), `agentver-backup-${id}-`))
  const originalPaths: string[] = []

  const uniquePaths = [...new Set(paths)]

  for (const [i, originalPath] of uniquePaths.entries()) {
    if (!existsSync(originalPath)) continue

    const backupPath = join(tempDir, `target-${String(i)}`)
    cpSync(originalPath, backupPath, { recursive: true, dereference: false })
    originalPaths.push(originalPath)
  }

  return {
    id,
    backupPath: tempDir,
    originalPaths,
    cleanup: () => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true })
      }
    },
  }
}

/**
 * Restores files from a backup handle, replacing whatever currently
 * exists at the original paths.
 *
 * Each backed-up item is restored by removing the current content at
 * the original path and copying the backup back in place.
 */
export function restoreFilesystemBackup(handle: BackupHandle): void {
  if (!existsSync(handle.backupPath)) return

  const uniquePaths = [...new Set(handle.originalPaths)]

  for (const [i, originalPath] of uniquePaths.entries()) {
    const backupPath = join(handle.backupPath, `target-${String(i)}`)

    if (!existsSync(backupPath)) continue

    rmSync(originalPath, { recursive: true, force: true })
    mkdirSync(dirname(originalPath), { recursive: true })
    cpSync(backupPath, originalPath, { recursive: true, dereference: false })
  }
}
