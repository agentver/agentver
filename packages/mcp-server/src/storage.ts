import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Lockfile, Manifest } from '@agentver/shared'

const AGENTVER_DIR = '.agentver'
const MANIFEST_FILE = 'manifest.json'
const LOCKFILE_FILE = 'lockfile.json'

// -- Manifest --

function getManifestPath(projectRoot: string): string {
  return join(projectRoot, AGENTVER_DIR, MANIFEST_FILE)
}

export function readManifest(projectRoot: string): Manifest {
  const manifestPath = getManifestPath(projectRoot)

  if (!existsSync(manifestPath)) {
    return { version: 1, packages: {} }
  }

  const raw = readFileSync(manifestPath, 'utf-8')

  try {
    return JSON.parse(raw) as Manifest
  } catch {
    return { version: 1, packages: {} }
  }
}

export function writeManifest(projectRoot: string, manifest: Manifest): void {
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

export function readLockfile(projectRoot: string): Lockfile {
  const lockfilePath = getLockfilePath(projectRoot)

  if (!existsSync(lockfilePath)) {
    return { version: 1, packages: {} }
  }

  const raw = readFileSync(lockfilePath, 'utf-8')

  try {
    return JSON.parse(raw) as Lockfile
  } catch {
    return { version: 1, packages: {} }
  }
}

export function writeLockfile(projectRoot: string, lockfile: Lockfile): void {
  const dir = join(projectRoot, AGENTVER_DIR)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(getLockfilePath(projectRoot), JSON.stringify(lockfile, null, 2))
}
