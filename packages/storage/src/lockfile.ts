import { existsSync, readFileSync } from 'node:fs'
import type { LockfileV2 } from '@agentver/shared'
import {
  lockfileAnySchema,
  lockfileV2PackageSchema,
  normaliseLockfileV2,
  STORAGE_SCHEMA_VERSION,
} from '@agentver/shared'
import { StorageCorruptionError } from './errors'
import { withStorageLock } from './file-lock'
import { ensureStorageDir, getLockfilePath, writeJsonFileAtomic } from './files'
import type { LockOptions, ReadOptions, ReadResult, Scope } from './types'

const EMPTY_LOCKFILE: LockfileV2 = { version: STORAGE_SCHEMA_VERSION, packages: {} }

/**
 * Reads and normalises the lockfile.
 *
 * - Missing file returns empty lockfile (expected on first run)
 * - Invalid JSON throws StorageCorruptionError
 * - Per-entry recovery rescues valid entries from a partially corrupt lockfile
 * - Does NOT write back on read — check `dirty` flag and persist explicitly if needed
 */
export function readLockfile(
  projectRoot: string,
  scope: Scope = 'project',
  options?: ReadOptions
): ReadResult<LockfileV2> {
  const lockfilePath = getLockfilePath(projectRoot, scope)

  if (!existsSync(lockfilePath)) {
    return { data: { ...EMPTY_LOCKFILE, packages: {} }, dirty: false, droppedEntries: [] }
  }

  const raw = readFileSync(lockfilePath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new StorageCorruptionError(lockfilePath, 'invalid-json')
  }

  const result = lockfileAnySchema.safeParse(parsed)
  if (!result.success) {
    const raw2 = parsed as Record<string, unknown>
    if (
      raw2?.version === STORAGE_SCHEMA_VERSION &&
      typeof raw2?.packages === 'object' &&
      raw2.packages !== null
    ) {
      const recovered: LockfileV2['packages'] = {}
      const droppedEntries: Array<{ key: string; reason: string }> = []

      for (const [name, entry] of Object.entries(raw2.packages as Record<string, unknown>)) {
        const entryResult = lockfileV2PackageSchema.safeParse(entry)
        if (entryResult.success) {
          recovered[name] = entryResult.data
        } else {
          droppedEntries.push({ key: name, reason: entryResult.error.message })
          options?.onWarning?.(
            `Dropping invalid lockfile entry "${name}" — ${entryResult.error.message}`
          )
        }
      }

      if (Object.keys(recovered).length > 0) {
        options?.onWarning?.(
          `Recovered ${Object.keys(recovered).length} entry/entries from lockfile (${droppedEntries.length} dropped)`
        )
        const normalised = normaliseLockfileV2({
          version: STORAGE_SCHEMA_VERSION,
          packages: recovered,
        })
        return { data: normalised, dirty: true, droppedEntries }
      }
    }

    throw new StorageCorruptionError(lockfilePath, 'schema-validation-failed')
  }

  const normalised = normaliseLockfileV2(result.data)
  const dirty = JSON.stringify(normalised) !== JSON.stringify(result.data)

  return { data: normalised, dirty, droppedEntries: [] }
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
