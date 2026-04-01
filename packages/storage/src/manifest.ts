import { existsSync, readFileSync } from 'node:fs'
import type { ManifestV2 } from '@agentver/shared'
import { manifestV2Schema, STORAGE_SCHEMA_VERSION } from '@agentver/shared'
import { StorageCorruptionError } from './errors'
import { withStorageLock } from './file-lock'
import { ensureStorageDir, getManifestPath, writeJsonFileAtomic } from './files'
import type { LockOptions, ReadOptions, ReadResult, Scope } from './types'

const EMPTY_MANIFEST: ManifestV2 = { version: STORAGE_SCHEMA_VERSION, packages: {} }

export function readManifest(
  projectRoot: string,
  scope: Scope = 'project',
  options?: ReadOptions
): ReadResult<ManifestV2> {
  const manifestPath = getManifestPath(projectRoot, scope)

  if (!existsSync(manifestPath)) {
    return { data: { ...EMPTY_MANIFEST, packages: {} } }
  }

  const raw = readFileSync(manifestPath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new StorageCorruptionError(manifestPath, 'invalid-json')
  }

  const result = manifestV2Schema.safeParse(parsed)
  if (!result.success) {
    options?.onWarning?.(`Invalid manifest at ${manifestPath}: ${result.error.message}`)
    return { data: { version: STORAGE_SCHEMA_VERSION, packages: {} } }
  }

  return { data: result.data }
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
