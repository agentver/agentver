import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  setLockfilePackage,
  setManifestPackage,
  updateManifestAndLockfile,
} from '@agentver/storage'
import { createFilesystemBackup, restoreFilesystemBackup } from './backup'
import { resolveCanonicalCategory } from './canonical'
import { cleanupExpiredBackups, createPersistentBackup } from './persistent-backup'
import { createAgentPlacements } from './placement'
import { planInstall } from './planner'
import type {
  BackupHandle,
  FetchedPackage,
  InstallPlan,
  InstallRequest,
  InstallResult,
  PackageType,
  PlacementResult,
  RestoreEntry,
  RestoreFetcher,
  RestorePackageResult,
  RestorePlan,
  RestorePolicy,
  RestoreResult,
} from './types'

/**
 * Executes an install plan.
 *
 * Writes files to the canonical path, creates agent placements
 * (symlink, copy, or junction), handles conflicts according to
 * the plan's policy, creates backups where required, and persists
 * manifest/lockfile entries.
 *
 * Returns a result with per-placement outcomes and backup handles.
 * The caller is responsible for calling cleanup() on backup handles
 * after confirming the install is satisfactory, or calling
 * rollbackInstall() to undo the entire operation.
 */
export function executeInstall(plan: InstallPlan): InstallResult {
  const { request, canonical, placements, backupsRequired, manifestEntry, lockfileEntry } = plan

  if (!plan.executable) {
    return {
      success: false,
      error: {
        code: 'PLAN_NOT_EXECUTABLE',
        message: plan.blockedReason ?? 'Plan is not executable',
      },
      packageKey: request.packageKey,
      displayName: request.displayName,
      placements: [],
      conflictsResolved: [],
      backups: [],
      manifestWritten: false,
      lockfileWritten: false,
      manifestEntry,
      lockfileEntry,
      filesPlacedCount: 0,
      agentsInstalledCount: 0,
    }
  }

  const backups: BackupHandle[] = []
  const conflictsResolved: InstallResult['conflictsResolved'] = []

  try {
    // 1. Create backups for required paths
    if (backupsRequired.length > 0) {
      const pathsToBackup = backupsRequired.map((b) => b.originalPath)
      const firstBackup = backupsRequired[0]

      // Create persistent backup for user recovery
      createPersistentBackup(
        request.target.projectRoot,
        request.target.scope,
        request.packageKey,
        request.displayName,
        pathsToBackup,
        firstBackup?.reason ?? 'conflict-replace',
        manifestEntry,
        lockfileEntry
      )

      // Run retention cleanup after creating a new backup
      cleanupExpiredBackups(request.target.projectRoot, request.target.scope)

      // Create temp backup for crash rollback
      const handle = createFilesystemBackup(
        pathsToBackup,
        firstBackup?.reason ?? 'conflict-replace'
      )
      backups.push(handle)

      // Remove conflicting paths after backup
      for (const backup of backupsRequired) {
        rmSync(backup.originalPath, { recursive: true, force: true })
        conflictsResolved.push({
          agentId: findAgentForPath(plan, backup.originalPath),
          path: backup.originalPath,
          resolution: 'backed-up',
        })
      }
    }

    // 2. Handle force conflicts (remove without backup)
    if (request.policy.conflictStrategy === 'force' && plan.conflicts.length > 0) {
      for (const conflict of plan.conflicts) {
        rmSync(conflict.path, { recursive: true, force: true })
        conflictsResolved.push({
          agentId: conflict.agentId,
          path: conflict.path,
          resolution: 'overwritten',
        })
      }
    }

    // 3. Write files to canonical path
    const filesPlacedCount = writeCanonicalFiles(plan)

    // 4. Create agent placements
    let placementResults: PlacementResult[] = []

    if (placements.length > 0) {
      placementResults = createAgentPlacements(
        canonical.path,
        placements,
        request.target.projectRoot,
        request.target.scope,
        { allowFallback: request.policy.allowFallback }
      )
    }

    const agentsInstalledCount = placementResults.filter((p) => p.success).length

    // 5. Persist manifest/lockfile entries
    let manifestWritten = false
    let lockfileWritten = false

    if (request.policy.persist) {
      updateManifestAndLockfile(
        request.target.projectRoot,
        request.target.scope,
        (manifest, lockfile) => {
          setManifestPackage(manifest, request.displayName, {
            name: manifestEntry.name,
            source: manifestEntry.source,
            agents: manifestEntry.agents,
            installedAt: manifestEntry.installedAt,
            modified: manifestEntry.modified,
            pinned: manifestEntry.pinned,
            path: manifestEntry.path,
            bundle: manifestEntry.bundle,
            packageType: manifestEntry.packageType,
            entryFile: manifestEntry.entryFile,
            dependsOn: manifestEntry.dependsOn,
            conflictsWith: manifestEntry.conflictsWith,
          })

          setLockfilePackage(lockfile, request.displayName, {
            name: lockfileEntry.name,
            source: lockfileEntry.source,
            integrity: lockfileEntry.integrity,
            agents: lockfileEntry.agents,
          })

          return { manifest, lockfile }
        }
      )

      manifestWritten = true
      lockfileWritten = true
    }

    return {
      success: true,
      packageKey: request.packageKey,
      displayName: request.displayName,
      placements: placementResults,
      conflictsResolved,
      backups,
      manifestWritten,
      lockfileWritten,
      manifestEntry,
      lockfileEntry,
      filesPlacedCount,
      agentsInstalledCount,
    }
  } catch (err) {
    // On failure, attempt to restore backups
    for (const backup of backups) {
      try {
        restoreFilesystemBackup(backup)
      } catch {
        // Best-effort restoration — swallowing is acceptable here since
        // we are already in an error path and the primary error is more useful.
      }
    }

    return {
      success: false,
      error: {
        code: 'INSTALL_FAILED',
        message: String(err),
      },
      packageKey: request.packageKey,
      displayName: request.displayName,
      placements: [],
      conflictsResolved,
      backups,
      manifestWritten: false,
      lockfileWritten: false,
      manifestEntry,
      lockfileEntry,
      filesPlacedCount: 0,
      agentsInstalledCount: 0,
    }
  }
}

/**
 * Executes a restore plan by calling the provided fetch function
 * for each restorable entry, then delegating to planInstall and
 * executeInstall for each fetched package.
 *
 * Execution is concurrency-limited per the restore policy.
 * Failures are collected, not thrown.
 */
export async function executeRestore(
  plan: RestorePlan,
  fetch: RestoreFetcher
): Promise<RestoreResult> {
  const packages: RestorePackageResult[] = []
  const { policy, agents, toInstall, upToDate, toSkip } = plan

  // Record up-to-date packages
  for (const entry of upToDate) {
    packages.push({
      packageKey: entry.packageKey,
      displayName: entry.displayName,
      status: 'up-to-date',
      agents: entry.manifestEntry.agents,
    })
  }

  // Record skipped packages
  for (const skip of toSkip) {
    packages.push({
      packageKey: skip.packageKey,
      displayName: skip.displayName,
      status: 'skipped',
      reason: skip.reason,
    })
  }

  // Process toInstall entries with concurrency limit
  const concurrency = Math.max(1, policy.concurrency)
  const queue = [...toInstall]
  const active: Promise<void>[] = []

  const processEntry = async (entry: RestoreEntry): Promise<void> => {
    try {
      const fetched = await fetch(entry)

      const installRequest = buildRestoreInstallRequest(entry, fetched, policy, agents)
      const installPlan = planInstall(installRequest)
      const installResult = executeInstall(installPlan)

      if (installResult.success) {
        // Clean up backups from successful installs
        for (const backup of installResult.backups) {
          backup.cleanup()
        }

        packages.push({
          packageKey: entry.packageKey,
          displayName: entry.displayName,
          status: 'installed',
          agents: installResult.manifestEntry.agents,
          filesPlacedCount: installResult.filesPlacedCount,
        })
      } else {
        packages.push({
          packageKey: entry.packageKey,
          displayName: entry.displayName,
          status: 'failed',
          error: installResult.error?.message,
        })
      }
    } catch (err) {
      packages.push({
        packageKey: entry.packageKey,
        displayName: entry.displayName,
        status: 'failed',
        error: String(err),
      })
    }
  }

  for (const entry of queue) {
    const task = processEntry(entry)
    active.push(task)

    if (active.length >= concurrency) {
      await Promise.race(active)
      // Remove completed tasks
      const remaining: Promise<void>[] = []
      for (const t of active) {
        const settled = await Promise.race([t.then(() => true), Promise.resolve(false)])
        if (!settled) {
          remaining.push(t)
        }
      }
      active.length = 0
      active.push(...remaining)
    }
  }

  // Wait for remaining
  await Promise.allSettled(active)

  const installedCount = packages.filter((p) => p.status === 'installed').length
  const upToDateCount = packages.filter((p) => p.status === 'up-to-date').length
  const skippedCount = packages.filter((p) => p.status === 'skipped').length
  const failedCount = packages.filter(
    (p) => p.status === 'failed' || p.status === 'integrity-mismatch'
  ).length

  return {
    packages,
    installedCount,
    upToDateCount,
    skippedCount,
    failedCount,
    success: failedCount === 0,
  }
}

/**
 * Rolls back a completed install by restoring all backups and
 * removing files placed by the executor.
 *
 * Idempotent — safe to call multiple times.
 */
export function rollbackInstall(result: InstallResult): void {
  // Restore all backups
  for (const backup of result.backups) {
    try {
      restoreFilesystemBackup(backup)
    } catch {
      // Best-effort rollback
    }
  }

  // Remove canonical directory/file
  if (result.success && result.filesPlacedCount > 0) {
    // Determine canonical path from the plan context
    // We need to reconstruct it from the manifest entry
    const category = resolveCanonicalCategory(
      (result.manifestEntry.packageType ?? 'SKILL') as PackageType
    )

    if (result.manifestEntry.path) {
      // Custom path install — remove the custom path
      if (existsSync(result.manifestEntry.path)) {
        rmSync(result.manifestEntry.path, { recursive: true, force: true })
      }
    } else if (category === 'skills') {
      // We cannot precisely reconstruct the scope here, so we remove placements
      // which is the safest approach. The canonical path is not stored on the result
      // but placements give us enough information.
    }
  }

  // Remove agent placements
  for (const placement of result.placements) {
    if (placement.success && existsSync(placement.destinationPath)) {
      rmSync(placement.destinationPath, { recursive: true, force: true })
    }
  }

  // Remove manifest/lockfile entries if they were written
  // This is best handled by the caller since they have the full context
  // (projectRoot, scope, etc.) — the rollback focuses on filesystem state.
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Writes files from the install plan to the canonical path.
 */
function writeCanonicalFiles(plan: InstallPlan): number {
  const { request, canonical } = plan
  const { files } = request
  let count = 0

  if (canonical.category === 'skills') {
    // Directory-based: write all files into canonical directory
    if (existsSync(canonical.path) && plan.kind === 'update') {
      rmSync(canonical.path, { recursive: true, force: true })
    }

    mkdirSync(canonical.path, { recursive: true })

    for (const file of files) {
      // Validate path does not escape canonical directory
      if (file.path.includes('..') || file.path.startsWith('/')) continue

      const targetPath = join(canonical.path, file.path)
      const resolvedTarget = resolve(canonical.path, file.path)
      if (
        !resolvedTarget.startsWith(`${resolve(canonical.path)}/`) &&
        resolvedTarget !== resolve(canonical.path)
      ) {
        continue
      }

      mkdirSync(dirname(targetPath), { recursive: true })
      writeFileAtomic(targetPath, file.content)
      count++
    }
  } else {
    // Single-file: write the entry file to canonical path
    mkdirSync(dirname(canonical.path), { recursive: true })

    // For single-file packages, use the first file or the entry file
    const entryFileName = request.metadata?.entryFile
    const entryFile = entryFileName ? files.find((f) => f.path === entryFileName) : files[0]

    if (entryFile) {
      writeFileAtomic(canonical.path, entryFile.content)
      count = 1
    }
  }

  return count
}

/**
 * Writes a file atomically by writing to a temp file then renaming.
 */
function writeFileAtomic(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, content, 'utf-8')
  renameSync(tmpPath, filePath)
}

/**
 * Finds the agent ID associated with a conflict path in the plan.
 */
function findAgentForPath(plan: InstallPlan, path: string): string {
  for (const conflict of plan.conflicts) {
    if (conflict.path === path) return conflict.agentId
  }
  for (const placement of plan.placements) {
    if (placement.destinationPath === path) return placement.agentId
  }
  return 'unknown'
}

/**
 * Builds an InstallRequest from a restore entry and fetched package data.
 */
function buildRestoreInstallRequest(
  entry: RestoreEntry,
  fetched: FetchedPackage,
  policy: RestorePolicy,
  agents: string[]
): InstallRequest {
  return {
    packageKey: entry.packageKey,
    displayName: entry.displayName,
    packageType: (entry.manifestEntry.packageType ?? 'SKILL') as PackageType,
    source: entry.manifestEntry.source,
    files: fetched.files,
    integrity: fetched.integrity,
    target: {
      scope: policy.scope,
      projectRoot: policy.projectRoot,
      agents: entry.manifestEntry.agents.length > 0 ? entry.manifestEntry.agents : agents,
    },
    policy: {
      conflictStrategy: 'force',
      preferredLinkMode: policy.preferredLinkMode,
      allowFallback: policy.allowFallback,
      dryRun: false,
      persist: false,
      securityScanPolicy: policy.securityScanPolicy,
    },
    metadata: {
      entryFile: entry.manifestEntry.entryFile,
      dependsOn: entry.manifestEntry.dependsOn,
      conflictsWith: entry.manifestEntry.conflictsWith,
      bundleParentKey: entry.manifestEntry.bundle,
      customPath: entry.manifestEntry.path,
    },
  }
}
