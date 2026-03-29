import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LockfileV2 } from '@agentver/shared'
import { lockfileAnySchema, lockfileV2PackageSchema, migrateLockfileV1ToV2 } from '@agentver/shared'
import type { Scope } from '../utils/paths'
import { createCliLogger } from '../utils.js'
import { type FileLockOptions, withStorageLock } from './file-lock'
import { serialiseDeterministic } from './serialise'

const logger = createCliLogger('lockfile')

const LOCKFILE_DIR = '.agentver'
const LOCKFILE_FILE = 'lockfile.json'

function getLockfileRoot(projectRoot: string, scope: Scope): string {
  if (scope === 'global') {
    return join(homedir(), LOCKFILE_DIR)
  }
  return join(projectRoot, LOCKFILE_DIR)
}

function getLockfilePath(projectRoot: string, scope: Scope = 'project'): string {
  return join(getLockfileRoot(projectRoot, scope), LOCKFILE_FILE)
}

export function readLockfile(projectRoot: string, scope: Scope = 'project'): LockfileV2 {
  const lockfilePath = getLockfilePath(projectRoot, scope)

  if (!existsSync(lockfilePath)) {
    return { version: 2, packages: {} }
  }

  const raw = readFileSync(lockfilePath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    logger.warn(`Corrupt lockfile at ${lockfilePath} — could not parse JSON. Using empty lockfile.`)
    return { version: 2, packages: {} }
  }

  const result = lockfileAnySchema.safeParse(parsed)
  if (!result.success) {
    // Full-schema parse failed — attempt per-entry recovery so one bad entry
    // does not wipe the entire lockfile.
    const raw2 = parsed as Record<string, unknown>
    if (raw2?.version === 2 && typeof raw2?.packages === 'object' && raw2.packages !== null) {
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
        return { version: 2, packages: recovered }
      }
    }
    logger.warn(
      `Invalid lockfile at ${lockfilePath} — schema validation failed. Using empty lockfile.`
    )
    return { version: 2, packages: {} }
  }

  if (result.data.version === 1) {
    const migrated = migrateLockfileV1ToV2(result.data)
    writeLockfileUnsafe(projectRoot, migrated, scope)
    return migrated
  }

  return result.data
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
 * Internal unlocked write — used by migration (already inside readLockfile)
 * and by writeLockfile (which acquires the lock itself).
 */
function writeLockfileUnsafe(
  projectRoot: string,
  lockfile: LockfileV2,
  scope: Scope = 'project'
): void {
  const dir = getLockfileRoot(projectRoot, scope)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const filePath = getLockfilePath(projectRoot, scope)
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, serialiseDeterministic(lockfile))
  renameSync(tmpPath, filePath)
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
