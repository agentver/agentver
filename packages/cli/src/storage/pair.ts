import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import type { Scope } from '../utils/paths'
import { type FileLockOptions, withStorageLock } from './file-lock'
import { readLockfile } from './lockfile'
import { readManifest } from './manifest'
import { recoverPendingStorageTransaction, writeStorageTransaction } from './transaction'

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
  lockOptions?: FileLockOptions
): {
  manifest: ManifestV2
  lockfile: LockfileV2
} {
  return withStorageLock(
    projectRoot,
    scope,
    () => {
      recoverPendingStorageTransaction(projectRoot, scope)
      const manifest = readManifest(projectRoot, scope)
      const lockfile = readLockfile(projectRoot, scope)
      const updated = updater(manifest, lockfile)
      writeStorageTransaction(projectRoot, updated.manifest, updated.lockfile, scope)
      return updated
    },
    lockOptions
  )
}
