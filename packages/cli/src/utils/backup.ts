import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import { readLockfile, writeLockfile } from '../storage/lockfile'
import { readManifest, writeManifest } from '../storage/manifest'

type ManifestEntry = ManifestV2['packages'][string]
type LockfileEntry = LockfileV2['packages'][string]

export type BackupState = {
  packageName: string
  projectRoot: string
  tempDir: string
  skillDir: string | null
  manifestEntry: ManifestEntry | null
  lockfileEntry: LockfileEntry | null
}

export function createBackup(
  packageName: string,
  projectRoot: string,
  skillDir: string | null
): BackupState {
  const tempDir = mkdtempSync(join(tmpdir(), 'agentver-backup-'))

  const manifest = readManifest(projectRoot)
  const manifestEntry = manifest.packages[packageName] ?? null

  const lockfile = readLockfile(projectRoot)
  const lockfileEntry = lockfile.packages[packageName] ?? null

  if (skillDir && existsSync(skillDir)) {
    const backupSkillDir = join(tempDir, 'files')
    mkdirSync(backupSkillDir, { recursive: true })
    cpSync(skillDir, backupSkillDir, { recursive: true })
  }

  return {
    packageName,
    projectRoot,
    tempDir,
    skillDir,
    manifestEntry,
    lockfileEntry,
  }
}

export function restoreBackup(backup: BackupState): void {
  // Restore skill files from backup
  if (backup.skillDir) {
    const backupSkillDir = join(backup.tempDir, 'files')

    if (existsSync(backupSkillDir)) {
      // Remove any partially-written new files
      if (existsSync(backup.skillDir)) {
        rmSync(backup.skillDir, { recursive: true, force: true })
      }

      mkdirSync(backup.skillDir, { recursive: true })
      cpSync(backupSkillDir, backup.skillDir, { recursive: true })
    }
  }

  // Restore manifest entry
  const manifest = readManifest(backup.projectRoot)

  if (backup.manifestEntry) {
    manifest.packages[backup.packageName] = backup.manifestEntry
  } else {
    delete manifest.packages[backup.packageName]
  }

  writeManifest(backup.projectRoot, manifest)

  // Restore lockfile entry
  const lockfile = readLockfile(backup.projectRoot)

  if (backup.lockfileEntry) {
    lockfile.packages[backup.packageName] = backup.lockfileEntry
  } else {
    delete lockfile.packages[backup.packageName]
  }

  writeLockfile(backup.projectRoot, lockfile)
}

export function cleanupBackup(backup: BackupState): void {
  if (existsSync(backup.tempDir)) {
    rmSync(backup.tempDir, { recursive: true, force: true })
  }
}
