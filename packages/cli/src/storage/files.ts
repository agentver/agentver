import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Scope } from '../utils/paths'
import { serialiseDeterministic } from './serialise'

const STORAGE_DIR = '.agentver'
const MANIFEST_FILE = 'manifest.json'
const LOCKFILE_FILE = 'lockfile.json'
const TRANSACTION_FILE = 'storage-transaction.json'

export function getStorageRoot(projectRoot: string, scope: Scope): string {
  if (scope === 'global') {
    return join(homedir(), STORAGE_DIR)
  }
  return join(projectRoot, STORAGE_DIR)
}

export function getManifestPath(projectRoot: string, scope: Scope = 'project'): string {
  return join(getStorageRoot(projectRoot, scope), MANIFEST_FILE)
}

export function getLockfilePath(projectRoot: string, scope: Scope = 'project'): string {
  return join(getStorageRoot(projectRoot, scope), LOCKFILE_FILE)
}

export function getStorageTransactionPath(projectRoot: string, scope: Scope = 'project'): string {
  return join(getStorageRoot(projectRoot, scope), TRANSACTION_FILE)
}

export function ensureStorageDir(projectRoot: string, scope: Scope = 'project'): void {
  const dir = getStorageRoot(projectRoot, scope)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, serialiseDeterministic(value))
  renameSync(tmpPath, filePath)
}
