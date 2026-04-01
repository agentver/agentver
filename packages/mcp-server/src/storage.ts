import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import {
  readLockfile as readLockfileRaw,
  readManifest as readManifestRaw,
  writeLockfile as writeLockfileRaw,
  writeManifest as writeManifestRaw,
} from '@agentver/storage'
import { logDebug } from './shared/context'

// -- Manifest --

export function readManifest(projectRoot: string): ManifestV2 {
  const result = readManifestRaw(projectRoot, 'project', {
    onWarning: (msg) => logDebug(msg),
  })
  return result.data
}

export function writeManifest(projectRoot: string, manifest: ManifestV2): void {
  writeManifestRaw(projectRoot, manifest, 'project', { mode: 'advisory' })
}

// -- Lockfile --

export function readLockfile(projectRoot: string): LockfileV2 {
  const result = readLockfileRaw(projectRoot, 'project', {
    onWarning: (msg) => logDebug(msg),
  })
  return result.data
}

export function writeLockfile(projectRoot: string, lockfile: LockfileV2): void {
  writeLockfileRaw(projectRoot, lockfile, 'project', { mode: 'advisory' })
}
