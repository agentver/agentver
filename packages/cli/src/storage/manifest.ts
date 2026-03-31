import { existsSync, readFileSync } from 'node:fs'
import type { ManifestV2 } from '@agentver/shared'
import { manifestAnySchema, manifestV2PackageSchema, migrateManifestV1ToV2 } from '@agentver/shared'
import type { Scope } from '../utils/paths'
import { createCliLogger } from '../utils.js'
import { type FileLockOptions, withStorageLock } from './file-lock'
import { ensureStorageDir, getManifestPath, writeJsonFileAtomic } from './files'
import { recoverPendingStorageTransaction } from './transaction'

const logger = createCliLogger('manifest')

export function readManifest(projectRoot: string, scope: Scope = 'project'): ManifestV2 {
  recoverPendingStorageTransaction(projectRoot, scope)
  const manifestPath = getManifestPath(projectRoot, scope)

  if (!existsSync(manifestPath)) {
    return { version: 2, packages: {} }
  }

  const raw = readFileSync(manifestPath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    logger.warn(`Corrupt manifest at ${manifestPath} — could not parse JSON. Using empty manifest.`)
    return { version: 2, packages: {} }
  }

  const result = manifestAnySchema.safeParse(parsed)
  if (!result.success) {
    // Full-schema parse failed — attempt per-entry recovery so one bad entry
    // does not wipe the entire manifest (e.g. an empty commit from a platform install).
    const raw2 = parsed as Record<string, unknown>
    if (raw2?.version === 2 && typeof raw2?.packages === 'object' && raw2.packages !== null) {
      const recovered: ManifestV2['packages'] = {}
      let dropped = 0
      for (const [name, entry] of Object.entries(raw2.packages as Record<string, unknown>)) {
        const entryResult = manifestV2PackageSchema.safeParse(entry)
        if (entryResult.success) {
          recovered[name] = entryResult.data
        } else {
          dropped++
          logger.warn(`Dropping invalid manifest entry "${name}" — ${entryResult.error.message}`)
        }
      }
      if (Object.keys(recovered).length > 0) {
        logger.warn(
          `Recovered ${Object.keys(recovered).length} entry/entries from manifest (${dropped} dropped)`
        )
        return { version: 2, packages: recovered }
      }
    }
    logger.warn(
      `Invalid manifest at ${manifestPath} — schema validation failed. Using empty manifest.`
    )
    return { version: 2, packages: {} }
  }

  if (result.data.version === 1) {
    const migrated = migrateManifestV1ToV2(result.data)
    writeManifestUnsafe(projectRoot, migrated, scope)
    return migrated
  }

  return result.data
}

/**
 * Writes the manifest file while holding the storage lock.
 * Safe for concurrent CLI processes operating on the same project.
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
    () => writeManifestUnsafe(projectRoot, manifest, scope),
    lockOptions
  )
}

/**
 * Internal unlocked write — used by migration (already inside readManifest)
 * and by writeManifest (which acquires the lock itself).
 */
export function writeManifestUnsafe(
  projectRoot: string,
  manifest: ManifestV2,
  scope: Scope = 'project'
): void {
  ensureStorageDir(projectRoot, scope)
  writeJsonFileAtomic(getManifestPath(projectRoot, scope), manifest)
}

/**
 * Reads the manifest, applies a transform, and writes it back — all under
 * a single storage lock. Prevents lost-update races between concurrent
 * CLI processes.
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
      writeManifestUnsafe(projectRoot, updated, scope)
      return updated
    },
    lockOptions
  )
}
