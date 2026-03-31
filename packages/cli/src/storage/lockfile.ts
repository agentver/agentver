import { existsSync, readFileSync } from 'node:fs'
import type { LockfileV2 } from '@agentver/shared'
import {
  lockfileAnySchema,
  lockfileV2PackageSchema,
  normaliseLockfileV2,
  STORAGE_SCHEMA_VERSION,
} from '@agentver/shared'
import type { Scope } from '../utils/paths'
import { createCliLogger } from '../utils.js'
import { type FileLockOptions, withStorageLock } from './file-lock'
import { ensureStorageDir, getLockfilePath, writeJsonFileAtomic } from './files'

const logger = createCliLogger('lockfile')

export function readLockfile(projectRoot: string, scope: Scope = 'project'): LockfileV2 {
  const lockfilePath = getLockfilePath(projectRoot, scope)

  if (!existsSync(lockfilePath)) {
    return { version: STORAGE_SCHEMA_VERSION, packages: {} }
  }

  const raw = readFileSync(lockfilePath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    logger.warn(`Corrupt lockfile at ${lockfilePath} — could not parse JSON. Using empty lockfile.`)
    return { version: STORAGE_SCHEMA_VERSION, packages: {} }
  }

  const result = lockfileAnySchema.safeParse(parsed)
  if (!result.success) {
    // Full-schema parse failed — attempt per-entry recovery so one bad entry
    // does not wipe the entire lockfile.
    const raw2 = parsed as Record<string, unknown>
    if (
      raw2?.version === STORAGE_SCHEMA_VERSION &&
      typeof raw2?.packages === 'object' &&
      raw2.packages !== null
    ) {
      const recovered: LockfileV2['packages'] = {}
      let dropped = 0
      for (const [name, entry] of Object.entries(raw2.packages as Record<string, unknown>)) {
        const entryResult = lockfileV2PackageSchema.safeParse(entry)
        if (entryResult.success) {
          recovered[name] = entryResult.data
        } else {
          dropped++
          logger.warn(`Dropping invalid lockfile entry "${name}" — ${entryResult.error.message}`)
        }
      }
      if (Object.keys(recovered).length > 0) {
        logger.warn(
          `Recovered ${Object.keys(recovered).length} entry/entries from lockfile (${dropped} dropped)`
        )
        return normaliseLockfileV2({ version: STORAGE_SCHEMA_VERSION, packages: recovered })
      }
    }
    logger.warn(
      `Invalid lockfile at ${lockfilePath} — schema validation failed. Using empty lockfile.`
    )
    return { version: STORAGE_SCHEMA_VERSION, packages: {} }
  }

  const normalised = normaliseLockfileV2(result.data)
  if (JSON.stringify(normalised) !== JSON.stringify(result.data)) {
    writeLockfileUnsafe(projectRoot, normalised, scope)
  }

  return normalised
}

/**
 * Writes the lockfile while holding the storage lock.
 * Safe for concurrent CLI processes operating on the same project.
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
    () => writeLockfileUnsafe(projectRoot, lockfile, scope),
    lockOptions
  )
}

/**
 * Internal unlocked write — used by normalisation (already inside readLockfile)
 * and by writeLockfile (which acquires the lock itself).
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
 * a single storage lock. Prevents lost-update races between concurrent
 * CLI processes.
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
      writeLockfileUnsafe(projectRoot, updated, scope)
      return updated
    },
    lockOptions
  )
}
