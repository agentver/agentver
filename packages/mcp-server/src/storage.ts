import { type LockfileV2, type ManifestV2, STORAGE_SCHEMA_VERSION } from '@agentver/shared'
import {
  readLockfile as readLockfileRaw,
  readManifest as readManifestRaw,
  StorageCorruptionError,
  writeLockfile as writeLockfileRaw,
  writeManifest as writeManifestRaw,
} from '@agentver/storage'
import { logDebug } from './shared/context'

// -- Manifest --

export function readManifest(projectRoot: string): ManifestV2 {
  try {
    const result = readManifestRaw(projectRoot, 'project', {
      onWarning: (msg) => logDebug(msg),
    })
    return result.data
  } catch (error) {
    if (error instanceof StorageCorruptionError) {
      logDebug(`Corrupt manifest detected, returning empty fallback: ${error.message}`)
      return { version: STORAGE_SCHEMA_VERSION, packages: {} }
    }
    throw error
  }
}

export function writeManifest(projectRoot: string, manifest: ManifestV2): void {
  writeManifestRaw(projectRoot, manifest, 'project', { mode: 'advisory' })
}

// -- Lockfile --

export function readLockfile(projectRoot: string): LockfileV2 {
  try {
    const result = readLockfileRaw(projectRoot, 'project', {
      onWarning: (msg) => logDebug(msg),
    })
    return result.data
  } catch (error) {
    if (error instanceof StorageCorruptionError) {
      logDebug(`Corrupt lockfile detected, returning empty fallback: ${error.message}`)
      return { version: STORAGE_SCHEMA_VERSION, packages: {} }
    }
    throw error
  }
}

export function writeLockfile(projectRoot: string, lockfile: LockfileV2): void {
  writeLockfileRaw(projectRoot, lockfile, 'project', { mode: 'advisory' })
}
