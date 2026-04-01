import { existsSync, readFileSync } from 'node:fs'
import type { LockfileV2 } from '@agentver/shared'
import { lockfileV2Schema, STORAGE_SCHEMA_VERSION } from '@agentver/shared'
import { StorageCorruptionError } from './errors'
import { withStorageLock } from './file-lock'
import { ensureStorageDir, getLockfilePath, writeJsonFileAtomic } from './files'
import type { LockOptions, ReadOptions, ReadResult, Scope } from './types'

const EMPTY_LOCKFILE: LockfileV2 = { version: STORAGE_SCHEMA_VERSION, packages: {} }

export function readLockfile(
  projectRoot: string,
  scope: Scope = 'project',
  options?: ReadOptions
): ReadResult<LockfileV2> {
  const lockfilePath = getLockfilePath(projectRoot, scope)

  if (!existsSync(lockfilePath)) {
    return { data: { ...EMPTY_LOCKFILE, packages: {} } }
  }

  const raw = readFileSync(lockfilePath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new StorageCorruptionError(lockfilePath, 'invalid-json')
  }

  const result = lockfileV2Schema.safeParse(parsed)
  if (!result.success) {
    options?.onWarning?.(`Invalid lockfile at ${lockfilePath}: ${result.error.message}`)
    return { data: { version: STORAGE_SCHEMA_VERSION, packages: {} } }
  }

  return { data: result.data }
}

/**
 * Writes the lockfile while holding the storage lock.
 * Safe for concurrent processes operating on the same project.
 */
export function writeLockfile(
  projectRoot: string,
  lockfile: LockfileV2,
  scope: Scope = 'project',
  lockOptions?: LockOptions
): void {
  withStorageLock(
    projectRoot,
    scope,
    () => writeLockfileUnsafe(projectRoot, lockfile, scope),
    lockOptions
  )
}

/**
 * Internal unlocked write — used inside already-locked contexts
 * (e.g. updateManifestAndLockfile where the outer function holds the lock).
 */
export function writeLockfileUnsafe(
  projectRoot: string,
  lockfile: LockfileV2,
  scope: Scope = 'project'
): void {
  ensureStorageDir(projectRoot, scope)
  writeJsonFileAtomic(getLockfilePath(projectRoot, scope), lockfile)
}

/**
 * Reads the lockfile, applies a transform, and writes it back — all under
 * a single storage lock. Prevents lost-update races between concurrent processes.
 */
export function updateLockfile(
  projectRoot: string,
  scope: Scope,
  updater: (lockfile: LockfileV2) => LockfileV2,
  lockOptions?: LockOptions
): LockfileV2 {
  return withStorageLock(
    projectRoot,
    scope,
    () => {
      const { data: current } = readLockfile(projectRoot, scope)
      const updated = updater(current)
      writeLockfileUnsafe(projectRoot, updated, scope)
      return updated
    },
    lockOptions
  )
}
