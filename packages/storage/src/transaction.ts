import { existsSync, readFileSync, rmSync } from 'node:fs'
import {
  type LockfileV2,
  lockfileV2Schema,
  type ManifestV2,
  manifestV2Schema,
} from '@agentver/shared'
import {
  ensureStorageDir,
  getLockfilePath,
  getManifestPath,
  getStorageTransactionPath,
  writeJsonFileAtomic,
} from './files'
import type { Scope, StorageCallbacks } from './types'

type StorageTransaction = {
  manifest: ManifestV2
  lockfile: LockfileV2
}

/**
 * Recovers a pending storage transaction if one exists.
 *
 * This runs at the start of every paired update. If the process crashed
 * between writing the journal and deleting it, the journal contains the
 * intended final state and is replayed.
 */
export function recoverPendingStorageTransaction(
  projectRoot: string,
  scope: Scope = 'project',
  callbacks?: StorageCallbacks
): void {
  const transactionPath = getStorageTransactionPath(projectRoot, scope)

  if (!existsSync(transactionPath)) {
    return
  }

  try {
    const raw = readFileSync(transactionPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<StorageTransaction>

    if (!parsed.manifest || !parsed.lockfile) {
      callbacks?.onWarning?.(`Ignoring invalid storage transaction at ${transactionPath}`)
      rmSync(transactionPath, { force: true })
      return
    }

    const manifestResult = manifestV2Schema.safeParse(parsed.manifest)
    const lockfileResult = lockfileV2Schema.safeParse(parsed.lockfile)

    if (!manifestResult.success || !lockfileResult.success) {
      callbacks?.onWarning?.(`Ignoring invalid storage transaction at ${transactionPath}`)
      rmSync(transactionPath, { force: true })
      return
    }

    ensureStorageDir(projectRoot, scope)
    writeJsonFileAtomic(getManifestPath(projectRoot, scope), manifestResult.data)
    writeJsonFileAtomic(getLockfilePath(projectRoot, scope), lockfileResult.data)
    rmSync(transactionPath, { force: true })
    callbacks?.onWarning?.(`Recovered pending storage transaction at ${transactionPath}`)
  } catch (error) {
    callbacks?.onWarning?.(
      `Failed to recover storage transaction at ${transactionPath}: ${String(error)}`
    )
    rmSync(transactionPath, { force: true })
  }
}

/**
 * Writes a transaction journal and then atomically writes both files.
 * The journal is deleted after both writes succeed. If the process crashes
 * between any of these steps, recoverPendingStorageTransaction will replay.
 */
export function writeStorageTransaction(
  projectRoot: string,
  manifest: ManifestV2,
  lockfile: LockfileV2,
  scope: Scope = 'project'
): void {
  ensureStorageDir(projectRoot, scope)

  const transactionPath = getStorageTransactionPath(projectRoot, scope)
  const transaction: StorageTransaction = { manifest, lockfile }

  writeJsonFileAtomic(transactionPath, transaction)
  writeJsonFileAtomic(getManifestPath(projectRoot, scope), manifest)
  writeJsonFileAtomic(getLockfilePath(projectRoot, scope), lockfile)
  rmSync(transactionPath, { force: true })
}
