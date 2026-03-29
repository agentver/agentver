import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ManifestV2 } from '@agentver/shared'
import { manifestAnySchema, migrateManifestV1ToV2 } from '@agentver/shared'
import type { Scope } from '../utils/paths'
import { createCliLogger } from '../utils.js'
import { type FileLockOptions, withStorageLock } from './file-lock'
import { serialiseDeterministic } from './serialise'

const logger = createCliLogger('manifest')

const MANIFEST_DIR = '.agentver'
const MANIFEST_FILE = 'manifest.json'

function getManifestRoot(projectRoot: string, scope: Scope): string {
  if (scope === 'global') {
    return join(homedir(), MANIFEST_DIR)
  }
  return join(projectRoot, MANIFEST_DIR)
}

function getManifestPath(projectRoot: string, scope: Scope = 'project'): string {
  return join(getManifestRoot(projectRoot, scope), MANIFEST_FILE)
}

export function readManifest(projectRoot: string, scope: Scope = 'project'): ManifestV2 {
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
function writeManifestUnsafe(
  projectRoot: string,
  manifest: ManifestV2,
  scope: Scope = 'project'
): void {
  const dir = getManifestRoot(projectRoot, scope)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const filePath = getManifestPath(projectRoot, scope)
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, serialiseDeterministic(manifest))
  renameSync(tmpPath, filePath)
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
