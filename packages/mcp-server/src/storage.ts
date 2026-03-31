import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import {
  lockfileAnySchema,
  manifestAnySchema,
  normaliseLockfileV2,
  normaliseManifestV2,
  STORAGE_SCHEMA_VERSION,
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
    return { version: STORAGE_SCHEMA_VERSION, packages: {} }
  }

  const raw = readFileSync(manifestPath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { version: STORAGE_SCHEMA_VERSION, packages: {} }
  }

  const result = manifestAnySchema.safeParse(parsed)
  if (!result.success) {
    logDebug(`Manifest at ${manifestPath} failed schema validation, treating as empty`)
    return { version: STORAGE_SCHEMA_VERSION, packages: {} }
  }

  const normalised = normaliseManifestV2(result.data)
  if (JSON.stringify(normalised) !== JSON.stringify(result.data)) {
    writeManifest(projectRoot, normalised)
  }

  return normalised
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
    return { version: STORAGE_SCHEMA_VERSION, packages: {} }
  }

  const raw = readFileSync(lockfilePath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { version: STORAGE_SCHEMA_VERSION, packages: {} }
  }

  const result = lockfileAnySchema.safeParse(parsed)
  if (!result.success) {
    logDebug(`Lockfile at ${lockfilePath} failed schema validation, treating as empty`)
    return { version: STORAGE_SCHEMA_VERSION, packages: {} }
  }

  const normalised = normaliseLockfileV2(result.data)
  if (JSON.stringify(normalised) !== JSON.stringify(result.data)) {
    writeLockfile(projectRoot, normalised)
  }

  return normalised
}

export function writeLockfile(projectRoot: string, lockfile: LockfileV2): void {
  const dir = join(projectRoot, AGENTVER_DIR)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(getLockfilePath(projectRoot), JSON.stringify(lockfile, null, 2))
}
