import { existsSync, readFileSync } from 'node:fs'
import type { ManifestV2 } from '@agentver/shared'
import {
  manifestAnySchema,
  manifestV2PackageSchema,
  normaliseManifestV2,
  STORAGE_SCHEMA_VERSION,
} from '@agentver/shared'
import { StorageCorruptionError } from './errors'
import { withStorageLock } from './file-lock'
import { ensureStorageDir, getManifestPath, writeJsonFileAtomic } from './files'
import type { LockOptions, ReadOptions, ReadResult, Scope } from './types'

const EMPTY_MANIFEST: ManifestV2 = { version: STORAGE_SCHEMA_VERSION, packages: {} }

/**
 * Reads and normalises the manifest file.
 *
 * - Missing file returns empty manifest (expected on first run)
 * - Invalid JSON throws StorageCorruptionError
 * - Per-entry recovery rescues valid entries from a partially corrupt manifest
 * - Does NOT write back on read — check `dirty` flag and persist explicitly if needed
 */
export function readManifest(
  projectRoot: string,
  scope: Scope = 'project',
  options?: ReadOptions
): ReadResult<ManifestV2> {
  const manifestPath = getManifestPath(projectRoot, scope)

  if (!existsSync(manifestPath)) {
    return { data: { ...EMPTY_MANIFEST, packages: {} }, dirty: false, droppedEntries: [] }
  }

  const raw = readFileSync(manifestPath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new StorageCorruptionError(manifestPath, 'invalid-json')
  }

  const result = manifestAnySchema.safeParse(parsed)
  if (!result.success) {
    const raw2 = parsed as Record<string, unknown>
    if (
      raw2?.version === STORAGE_SCHEMA_VERSION &&
      typeof raw2?.packages === 'object' &&
      raw2.packages !== null
    ) {
      const recovered: ManifestV2['packages'] = {}
      const droppedEntries: Array<{ key: string; reason: string }> = []

      for (const [name, entry] of Object.entries(raw2.packages as Record<string, unknown>)) {
        const entryResult = manifestV2PackageSchema.safeParse(entry)
        if (entryResult.success) {
          recovered[name] = entryResult.data
        } else {
          droppedEntries.push({ key: name, reason: entryResult.error.message })
          options?.onWarning?.(
            `Dropping invalid manifest entry "${name}" — ${entryResult.error.message}`
          )
        }
      }

      if (Object.keys(recovered).length > 0) {
        options?.onWarning?.(
          `Recovered ${Object.keys(recovered).length} entry/entries from manifest (${droppedEntries.length} dropped)`
        )
        const normalised = normaliseManifestV2({
          version: STORAGE_SCHEMA_VERSION,
          packages: recovered,
        })
        return { data: normalised, dirty: true, droppedEntries }
      }
    }

    throw new StorageCorruptionError(manifestPath, 'schema-validation-failed')
  }

  const normalised = normaliseManifestV2(result.data)
  const dirty = JSON.stringify(normalised) !== JSON.stringify(result.data)

  return { data: normalised, dirty, droppedEntries: [] }
}

/**
 * Writes the manifest file while holding the storage lock.
 * Safe for concurrent processes operating on the same project.
 */
export function writeManifest(
  projectRoot: string,
  manifest: ManifestV2,
  scope: Scope = 'project',
  lockOptions?: LockOptions
): void {
  withStorageLock(
    projectRoot,
    scope,
    () => writeManifestUnsafe(projectRoot, manifest, scope),
    lockOptions
  )
}

/**
 * Internal unlocked write — used inside already-locked contexts
 * (e.g. updateManifestAndLockfile where the outer function holds the lock).
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
 * a single storage lock. Prevents lost-update races between concurrent processes.
 */
export function updateManifest(
  projectRoot: string,
  scope: Scope,
  updater: (manifest: ManifestV2) => ManifestV2,
  lockOptions?: LockOptions
): ManifestV2 {
  return withStorageLock(
    projectRoot,
    scope,
    () => {
      const { data: current } = readManifest(projectRoot, scope)
      const updated = updater(current)
      writeManifestUnsafe(projectRoot, updated, scope)
      return updated
    },
    lockOptions
  )
}
