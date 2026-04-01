import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import { withStorageLock } from './file-lock'
import { readLockfile } from './lockfile'
import { readManifest } from './manifest'
import { recoverPendingStorageTransaction, writeStorageTransaction } from './transaction'
import type { LockOptions, Scope, StorageCallbacks } from './types'

/**
 * Atomically updates both manifest and lockfile under a single lock.
 *
 * Sequence:
 * 1. Acquire lock
 * 2. Recover any pending transaction
 * 3. Read and normalise both files
 * 4. Call updater with current state
 * 5. Write transaction journal, then both files, then delete journal
 * 6. Release lock
 */
export function updateManifestAndLockfile(
  projectRoot: string,
  scope: Scope,
  updater: (
    manifest: ManifestV2,
    lockfile: LockfileV2
  ) => {
    manifest: ManifestV2
    lockfile: LockfileV2
  },
  lockOptions?: LockOptions,
  callbacks?: StorageCallbacks
): {
  manifest: ManifestV2
  lockfile: LockfileV2
} {
  return withStorageLock(
    projectRoot,
    scope,
    () => {
      recoverPendingStorageTransaction(projectRoot, scope, callbacks)
      const { data: manifest } = readManifest(projectRoot, scope)
      const { data: lockfile } = readLockfile(projectRoot, scope)
      const updated = updater(manifest, lockfile)
      writeStorageTransaction(projectRoot, updated.manifest, updated.lockfile, scope)
      return updated
    },
    lockOptions,
    callbacks
  )
}
