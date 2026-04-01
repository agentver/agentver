import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import { readLockfile, writeLockfile } from '../storage/lockfile'
import { readManifest, writeManifest } from '../storage/manifest'
import type { Scope } from './paths'

type ManifestEntry = ManifestV2['packages'][string]
type LockfileEntry = LockfileV2['packages'][string]

export type BackupState = {
  packageName: string
  projectRoot: string
  tempDir: string
  skillDir: string | null
  skillDirs: string[]
  manifestEntry: ManifestEntry | null
  lockfileEntry: LockfileEntry | null
  scope: Scope
}

export type FilesystemBackupState = {
  tempDir: string
  targets: Array<{
    originalPath: string
    backupPath: string
  }>
}

export function createBackup(
  packageName: string,
  projectRoot: string,
  skillDir: string | string[] | null,
  scope: Scope = 'project'
): BackupState {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentver-backup-'))
  const skillDirs = [...new Set(Array.isArray(skillDir) ? skillDir : skillDir ? [skillDir] : [])]

  const manifest = readManifest(projectRoot, scope)
  const manifestEntry = manifest.packages[packageName] ?? null

  const lockfile = readLockfile(projectRoot, scope)
  const lockfileEntry = lockfile.packages[packageName] ?? null

  skillDirs.forEach((path, index) => {
    if (!existsSync(path)) {
      return
    }

    const backupSkillDir = join(tempDir, 'files', String(index))
    mkdirSync(dirname(backupSkillDir), { recursive: true })
    cpSync(path, backupSkillDir, { recursive: true, dereference: true })
  })

  return {
    packageName,
    projectRoot,
    tempDir,
    skillDir: skillDirs[0] ?? null,
    skillDirs,
    manifestEntry,
    lockfileEntry,
    scope,
  }
}

export function restoreBackup(backup: BackupState): void {
  // Restore skill files from backup
  const skillDirs =
    (backup.skillDirs?.length ?? 0) > 0
      ? backup.skillDirs
      : backup.skillDir
        ? [backup.skillDir]
        : []

  skillDirs.forEach((skillDir, index) => {
    const backupSkillDir = join(backup.tempDir, 'files', String(index))

    if (!existsSync(backupSkillDir)) {
      return
    }

    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true, force: true })
    }

    mkdirSync(skillDir, { recursive: true })
    cpSync(backupSkillDir, skillDir, { recursive: true })
  })

  // Restore manifest entry
  const manifest = readManifest(backup.projectRoot, backup.scope)

  if (backup.manifestEntry) {
    manifest.packages[backup.packageName] = backup.manifestEntry
  } else {
    delete manifest.packages[backup.packageName]
  }

  writeManifest(backup.projectRoot, manifest, backup.scope)

  // Restore lockfile entry
  const lockfile = readLockfile(backup.projectRoot, backup.scope)

  if (backup.lockfileEntry) {
    lockfile.packages[backup.packageName] = backup.lockfileEntry
  } else {
    delete lockfile.packages[backup.packageName]
  }

  writeLockfile(backup.projectRoot, lockfile, backup.scope)
}

export function createFilesystemBackup(paths: string[]): FilesystemBackupState {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentver-fs-backup-'))
  const targets = [...new Set(paths)]
    .filter((path) => existsSync(path))
    .map((originalPath, index) => {
      const backupPath = join(tempDir, `target-${String(index)}`)
      cpSync(originalPath, backupPath, { recursive: true, dereference: false })
      return { originalPath, backupPath }
    })

  return { tempDir, targets }
}

export function restoreFilesystemBackup(backup: FilesystemBackupState): void {
  for (const target of backup.targets) {
    rmSync(target.originalPath, { recursive: true, force: true })
    mkdirSync(dirname(target.originalPath), { recursive: true })
    cpSync(target.backupPath, target.originalPath, { recursive: true, dereference: false })
  }
}

export function cleanupBackup(backup: BackupState | FilesystemBackupState): void {
  if (existsSync(backup.tempDir)) {
    rmSync(backup.tempDir, { recursive: true, force: true })
  }
}
