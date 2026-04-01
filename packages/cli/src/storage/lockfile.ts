import type { LockfileV2 } from '@agentver/shared'
import { STORAGE_SCHEMA_VERSION } from '@agentver/shared'
import type { Scope } from '@agentver/storage'
import {
  ensureStorageDir,
  getLockfilePath,
  readLockfile as readLockfileRaw,
  StorageCorruptionError,
  writeJsonFileAtomic,
} from '@agentver/storage'
import { createCliLogger } from '../utils.js'
import { type FileLockOptions, withStorageLock } from './file-lock'

const logger = createCliLogger('lockfile')

/**
 * Reads the lockfile, returning the raw LockfileV2 (unwrapping ReadResult).
 * Falls back to an empty lockfile on corruption, matching the CLI's original behaviour.
 */
export function readLockfile(projectRoot: string, scope: Scope = 'project'): LockfileV2 {
  try {
    const result = readLockfileRaw(projectRoot, scope, {
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
 * Writes the lockfile while holding the storage lock.
 * Uses the CLI's own lock so test mocks on file-lock still work.
 */
export function writeLockfile(
  projectRoot: string,
  lockfile: LockfileV2,
  scope: Scope = 'project',
  lockOptions?: FileLockOptions
): void {
  withStorageLock(
    projectRoot,
    scope,
    () => {
      ensureStorageDir(projectRoot, scope)
      writeJsonFileAtomic(getLockfilePath(projectRoot, scope), lockfile)
    },
    lockOptions
  )
}

/**
 * Reads the lockfile, applies a transform, and writes it back — all under
 * a single storage lock. Prevents lost-update races.
 */
export function updateLockfile(
  projectRoot: string,
  scope: Scope,
  updater: (lockfile: LockfileV2) => LockfileV2,
  lockOptions?: FileLockOptions
): LockfileV2 {
  return withStorageLock(
    projectRoot,
    scope,
    () => {
      const current = readLockfile(projectRoot, scope)
      const updated = updater(current)
      ensureStorageDir(projectRoot, scope)
      writeJsonFileAtomic(getLockfilePath(projectRoot, scope), updated)
      return updated
    },
    lockOptions
  )
}
