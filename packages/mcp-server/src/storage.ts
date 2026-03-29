import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import {
  lockfileAnySchema,
  manifestAnySchema,
  migrateLockfileV1ToV2,
  migrateManifestV1ToV2,
} from '@agentver/shared'
import { logDebug } from './shared/context'

const AGENTVER_DIR = '.agentver'
const MANIFEST_FILE = 'manifest.json'
const LOCKFILE_FILE = 'lockfile.json'

// -- Manifest --

function getManifestPath(projectRoot: string): string {
  return join(projectRoot, AGENTVER_DIR, MANIFEST_FILE)
}

export function readManifest(projectRoot: string): ManifestV2 {
  const manifestPath = getManifestPath(projectRoot)

  if (!existsSync(manifestPath)) {
    return { version: 2, packages: {} }
  }

  const raw = readFileSync(manifestPath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { version: 2, packages: {} }
  }

  const result = manifestAnySchema.safeParse(parsed)
  if (!result.success) {
    logDebug(`Manifest at ${manifestPath} failed schema validation, treating as empty`)
    return { version: 2, packages: {} }
  }

  if (result.data.version === 1) {
    logDebug(`Migrating v1 manifest at ${manifestPath} to v2`)
    const migrated = migrateManifestV1ToV2(result.data)
    writeManifest(projectRoot, migrated)
    return migrated
  }

  return result.data
}

export function writeManifest(projectRoot: string, manifest: ManifestV2): void {
  const dir = join(projectRoot, AGENTVER_DIR)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(getManifestPath(projectRoot), JSON.stringify(manifest, null, 2))
}

// -- Lockfile --

function getLockfilePath(projectRoot: string): string {
  return join(projectRoot, AGENTVER_DIR, LOCKFILE_FILE)
}

export function readLockfile(projectRoot: string): LockfileV2 {
  const lockfilePath = getLockfilePath(projectRoot)

  if (!existsSync(lockfilePath)) {
    return { version: 2, packages: {} }
  }

  const raw = readFileSync(lockfilePath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { version: 2, packages: {} }
  }

  const result = lockfileAnySchema.safeParse(parsed)
  if (!result.success) {
    logDebug(`Lockfile at ${lockfilePath} failed schema validation, treating as empty`)
    return { version: 2, packages: {} }
  }

  if (result.data.version === 1) {
    logDebug(`Migrating v1 lockfile at ${lockfilePath} to v2`)
    const migrated = migrateLockfileV1ToV2(result.data)
    writeLockfile(projectRoot, migrated)
    return migrated
  }

  return result.data
}

export function writeLockfile(projectRoot: string, lockfile: LockfileV2): void {
  const dir = join(projectRoot, AGENTVER_DIR)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(getLockfilePath(projectRoot), JSON.stringify(lockfile, null, 2))
}
