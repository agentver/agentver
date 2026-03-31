import { existsSync, readFileSync, rmSync } from 'node:fs'
import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import type { Scope } from '../utils/paths'
import { createCliLogger } from '../utils.js'
import {
  ensureStorageDir,
  getLockfilePath,
  getManifestPath,
  getStorageTransactionPath,
  writeJsonFileAtomic,
} from './files'

const logger = createCliLogger('storage:transaction')

type StorageTransaction = {
  manifest: ManifestV2
  lockfile: LockfileV2
}

export function recoverPendingStorageTransaction(
  projectRoot: string,
  scope: Scope = 'project'
): void {
  const transactionPath = getStorageTransactionPath(projectRoot, scope)

  if (!existsSync(transactionPath)) {
    return
  }

  try {
    const raw = readFileSync(transactionPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<StorageTransaction>

    if (!parsed.manifest || !parsed.lockfile) {
      logger.warn(`Ignoring invalid storage transaction at ${transactionPath}`)
      rmSync(transactionPath, { force: true })
      return
    }

    ensureStorageDir(projectRoot, scope)
    writeJsonFileAtomic(getManifestPath(projectRoot, scope), parsed.manifest)
    writeJsonFileAtomic(getLockfilePath(projectRoot, scope), parsed.lockfile)
    rmSync(transactionPath, { force: true })
    logger.warn(`Recovered pending storage transaction at ${transactionPath}`)
  } catch (error) {
    logger.warn(`Failed to recover storage transaction at ${transactionPath}: ${String(error)}`)
    rmSync(transactionPath, { force: true })
  }
}

export function writeStorageTransaction(
  projectRoot: string,
  manifest: ManifestV2,
  lockfile: LockfileV2,
  scope: Scope = 'project'
): void {
  ensureStorageDir(projectRoot, scope)

  const transactionPath = getStorageTransactionPath(projectRoot, scope)
  const transaction: StorageTransaction = { manifest, lockfile }

  writeJsonFileAtomic(transactionPath, transaction)
  writeJsonFileAtomic(getManifestPath(projectRoot, scope), manifest)
  writeJsonFileAtomic(getLockfilePath(projectRoot, scope), lockfile)
  rmSync(transactionPath, { force: true })
}
