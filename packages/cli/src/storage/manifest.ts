import type { ManifestV2 } from '@agentver/shared'
import { STORAGE_SCHEMA_VERSION } from '@agentver/shared'
import type { Scope } from '@agentver/storage'
import {
  ensureStorageDir,
  getManifestPath,
  readManifest as readManifestRaw,
  StorageCorruptionError,
  writeJsonFileAtomic,
} from '@agentver/storage'
import { createCliLogger } from '../utils.js'
import { type FileLockOptions, withStorageLock } from './file-lock'

const logger = createCliLogger('manifest')

/**
 * Reads the manifest, returning the raw ManifestV2 (unwrapping ReadResult).
 * Falls back to an empty manifest on corruption, matching the CLI's original behaviour.
 */
export function readManifest(projectRoot: string, scope: Scope = 'project'): ManifestV2 {
  try {
    const result = readManifestRaw(projectRoot, scope, {
      onWarning: (msg) => logger.warn(msg),
    })
    return result.data
  } catch (error) {
    if (error instanceof StorageCorruptionError) {
      logger.warn(error.message)
      return { version: STORAGE_SCHEMA_VERSION, packages: {} }
    }
    throw error
  }
}

/**
 * Writes the manifest file while holding the storage lock.
 * Uses the CLI's own lock so test mocks on file-lock still work.
 */
export function writeManifest(
  projectRoot: string,
  manifest: ManifestV2,
  scope: Scope = 'project',
  lockOptions?: FileLockOptions
): void {
  withStorageLock(
    projectRoot,
    scope,
    () => {
      ensureStorageDir(projectRoot, scope)
      writeJsonFileAtomic(getManifestPath(projectRoot, scope), manifest)
    },
    lockOptions
  )
}

/**
 * Reads the manifest, applies a transform, and writes it back — all under
 * a single storage lock. Prevents lost-update races.
 */
export function updateManifest(
  projectRoot: string,
  scope: Scope,
  updater: (manifest: ManifestV2) => ManifestV2,
  lockOptions?: FileLockOptions
): ManifestV2 {
  return withStorageLock(
    projectRoot,
    scope,
    () => {
      const current = readManifest(projectRoot, scope)
      const updated = updater(current)
      ensureStorageDir(projectRoot, scope)
      writeJsonFileAtomic(getManifestPath(projectRoot, scope), updated)
      return updated
    },
    lockOptions
  )
}
