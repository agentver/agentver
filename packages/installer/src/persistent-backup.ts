import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { BackupIndex, BackupIndexEntry, BackupItem, BackupReason } from '@agentver/shared'
import type { Scope } from '@agentver/storage'
import { getStorageRoot, writeJsonFileAtomic } from '@agentver/storage'

const BACKUPS_DIR = 'backups'
const INDEX_FILE = 'index.json'
const ITEMS_DIR = 'items'
const MAX_BACKUPS_PER_SCOPE = 20
const RETENTION_DAYS = 7

export type PersistentBackupHandle = {
  id: string
  backupDir: string
  entry: BackupIndexEntry
}

/**
 * Returns the backups root directory for the given scope.
 */
function getBackupsRoot(projectRoot: string, scope: Scope): string {
  return join(getStorageRoot(projectRoot, scope), BACKUPS_DIR)
}

/**
 * Returns the path to the backup index file.
 */
function getIndexPath(projectRoot: string, scope: Scope): string {
  return join(getBackupsRoot(projectRoot, scope), INDEX_FILE)
}

/**
 * Reads the backup index, returning an empty index if none exists.
 */
export function readBackupIndex(projectRoot: string, scope: Scope): BackupIndex {
  const indexPath = getIndexPath(projectRoot, scope)

  if (!existsSync(indexPath)) {
    return { version: 1, entries: [] }
  }

  try {
    const raw = readFileSync(indexPath, 'utf-8')
    const parsed = JSON.parse(raw) as BackupIndex

    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] }
    }

    return parsed
  } catch {
    return { version: 1, entries: [] }
  }
}

/**
 * Writes the backup index atomically.
 */
function writeBackupIndex(projectRoot: string, scope: Scope, index: BackupIndex): void {
  const backupsRoot = getBackupsRoot(projectRoot, scope)
  mkdirSync(backupsRoot, { recursive: true })
  writeJsonFileAtomic(getIndexPath(projectRoot, scope), index)
}

/**
 * Generates a unique backup ID from the current timestamp.
 * If a collision occurs, appends a numeric suffix.
 */
function generateBackupId(backupsRoot: string): string {
  const base = new Date().toISOString().replace(/[:.]/g, '-')
  let id = base

  let suffix = 1
  while (existsSync(join(backupsRoot, id))) {
    id = `${base}-${String(suffix)}`
    suffix++
  }

  return id
}

/**
 * Measures the size of a path (file or directory, recursively).
 */
function measureSize(targetPath: string, depth = 0): number {
  if (!existsSync(targetPath)) return 0
  if (depth > 50) return 0

  const stat = lstatSync(targetPath)

  if (stat.isFile()) return stat.size

  if (stat.isDirectory()) {
    let total = 0
    const entries = readdirSync(targetPath, { withFileTypes: true })
    for (const entry of entries) {
      total += measureSize(join(targetPath, entry.name), depth + 1)
    }
    return total
  }

  return 0
}

/**
 * Determines whether a path is a file or directory.
 */
function getPathKind(targetPath: string): 'file' | 'directory' {
  const stat = lstatSync(targetPath)
  return stat.isDirectory() ? 'directory' : 'file'
}

/**
 * Creates a persistent backup of the given paths.
 *
 * Files and directories are copied to `.agentver/backups/<id>/items/`,
 * an entry is appended to the index, and the index is written atomically.
 *
 * Returns a handle containing the backup ID and metadata.
 */
export function createPersistentBackup(
  projectRoot: string,
  scope: Scope,
  packageKey: string,
  displayName: string,
  paths: string[],
  reason: BackupReason,
  manifestEntry?: unknown,
  lockfileEntry?: unknown
): PersistentBackupHandle {
  const backupsRoot = getBackupsRoot(projectRoot, scope)
  mkdirSync(backupsRoot, { recursive: true })

  const id = generateBackupId(backupsRoot)
  const backupDir = join(backupsRoot, id)
  const itemsDir = join(backupDir, ITEMS_DIR)
  mkdirSync(itemsDir, { recursive: true })

  const uniquePaths = [...new Set(paths)]
  const items: BackupItem[] = []

  for (const [i, originalPath] of uniquePaths.entries()) {
    if (!existsSync(originalPath)) continue

    const backupRelativePath = `target-${String(i)}`
    const backupPath = join(itemsDir, backupRelativePath)

    cpSync(originalPath, backupPath, { recursive: true, dereference: true })

    items.push({
      originalPath,
      backupRelativePath,
      kind: getPathKind(originalPath),
      size: measureSize(originalPath),
    })
  }

  const entry: BackupIndexEntry = {
    id,
    createdAt: new Date().toISOString(),
    packageKey,
    displayName,
    reason,
    items,
    ...(manifestEntry !== undefined ? { manifestEntry } : {}),
    ...(lockfileEntry !== undefined ? { lockfileEntry } : {}),
  }

  const index = readBackupIndex(projectRoot, scope)
  index.entries.push(entry)
  writeBackupIndex(projectRoot, scope, index)

  return { id, backupDir, entry }
}

/**
 * Restores files from a persistent backup to their original locations.
 *
 * For each backed-up item, the current content at the original path
 * is removed and replaced with the backup copy.
 */
export function restorePersistentBackup(
  projectRoot: string,
  scope: Scope,
  backupId: string
): string[] {
  const index = readBackupIndex(projectRoot, scope)
  const entry = index.entries.find((e) => e.id === backupId)

  if (!entry) {
    throw new Error(`Backup not found: ${backupId}`)
  }

  const backupsRoot = getBackupsRoot(projectRoot, scope)
  const resolvedBackupsRoot = resolve(backupsRoot)
  const itemsDir = join(backupsRoot, backupId, ITEMS_DIR)
  const resolvedItemsDir = resolve(itemsDir)
  if (!resolvedItemsDir.startsWith(`${resolvedBackupsRoot}/`)) {
    throw new Error(`Invalid backup ID: path escapes backup root`)
  }

  if (!existsSync(itemsDir)) {
    throw new Error(`Backup files not found for: ${backupId}`)
  }

  const restoredPaths: string[] = []

  for (const item of entry.items) {
    const backupPath = join(itemsDir, item.backupRelativePath)
    const resolvedBackupPath = resolve(backupPath)
    if (!resolvedBackupPath.startsWith(`${resolve(itemsDir)}/`)) {
      continue
    }

    if (!existsSync(backupPath)) continue

    // Validate originalPath does not contain path traversal
    if (item.originalPath.includes('..') || !resolve(item.originalPath).startsWith('/')) {
      continue
    }

    if (existsSync(item.originalPath)) {
      rmSync(item.originalPath, { recursive: true, force: true })
    }

    mkdirSync(dirname(item.originalPath), { recursive: true })
    cpSync(backupPath, item.originalPath, { recursive: true, dereference: false })
    restoredPaths.push(item.originalPath)
  }

  return restoredPaths
}

/**
 * Lists all backup entries for the given scope.
 */
export function listBackups(projectRoot: string, scope: Scope): BackupIndexEntry[] {
  const index = readBackupIndex(projectRoot, scope)
  return index.entries
}

/**
 * Deletes a specific backup by ID: removes the backup directory
 * and its index entry.
 */
export function deleteBackup(projectRoot: string, scope: Scope, backupId: string): void {
  const index = readBackupIndex(projectRoot, scope)
  const entryIndex = index.entries.findIndex((e) => e.id === backupId)

  if (entryIndex === -1) {
    throw new Error(`Backup not found: ${backupId}`)
  }

  const backupsRoot = getBackupsRoot(projectRoot, scope)
  const backupDir = join(backupsRoot, backupId)
  const resolvedBackupDir = resolve(backupDir)
  if (!resolvedBackupDir.startsWith(`${resolve(backupsRoot)}/`)) {
    throw new Error(`Invalid backup ID: path escapes backup root`)
  }

  if (existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true, force: true })
  }

  index.entries.splice(entryIndex, 1)
  writeBackupIndex(projectRoot, scope, index)
}

/**
 * Removes expired backups according to the retention policy:
 * - Keep the last `maxCount` backups
 * - Never auto-delete a backup less than `retentionDays` old
 *
 * Returns the number of backups deleted.
 */
export function cleanupExpiredBackups(
  projectRoot: string,
  scope: Scope,
  options?: { maxCount?: number; retentionDays?: number }
): number {
  const maxCount = options?.maxCount ?? MAX_BACKUPS_PER_SCOPE
  const retentionDays = options?.retentionDays ?? RETENTION_DAYS

  const index = readBackupIndex(projectRoot, scope)

  if (index.entries.length <= maxCount) return 0

  const now = Date.now()
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000
  const backupsRoot = getBackupsRoot(projectRoot, scope)

  // Sort by creation date, oldest first
  const sorted = [...index.entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )

  const toRemove: string[] = []

  for (const entry of sorted) {
    if (index.entries.length - toRemove.length <= maxCount) break

    const age = now - new Date(entry.createdAt).getTime()
    if (age < retentionMs) continue

    toRemove.push(entry.id)
  }

  for (const id of toRemove) {
    const backupDir = join(backupsRoot, id)
    if (existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true, force: true })
    }
    const idx = index.entries.findIndex((e) => e.id === id)
    if (idx !== -1) {
      index.entries.splice(idx, 1)
    }
  }

  if (toRemove.length > 0) {
    writeBackupIndex(projectRoot, scope, index)
  }

  return toRemove.length
}

/**
 * Returns total size of all backup items across all entries.
 */
export function getBackupStorageSize(projectRoot: string, scope: Scope): number {
  const index = readBackupIndex(projectRoot, scope)
  let total = 0
  for (const entry of index.entries) {
    for (const item of entry.items) {
      total += item.size
    }
  }
  return total
}
