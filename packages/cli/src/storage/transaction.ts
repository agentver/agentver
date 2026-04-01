import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import type { Scope, StorageCallbacks } from '@agentver/storage'
import {
  recoverPendingStorageTransaction as recoverFromStorage,
  writeStorageTransaction as writeFromStorage,
} from '@agentver/storage'
import { createCliLogger } from '../utils.js'

const logger = createCliLogger('storage:transaction')

const cliCallbacks: StorageCallbacks = {
  onWarning: (message) => logger.warn(message),
}

export function recoverPendingStorageTransaction(
  projectRoot: string,
  scope: Scope = 'project'
): void {
  recoverFromStorage(projectRoot, scope, cliCallbacks)
}

export function writeStorageTransaction(
  projectRoot: string,
  manifest: ManifestV2,
  lockfile: LockfileV2,
  scope: Scope = 'project'
): void {
  writeFromStorage(projectRoot, manifest, lockfile, scope)
}
