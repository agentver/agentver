import { join } from 'node:path'
import type { Scope } from '@agentver/storage'
import { getStorageRoot } from '@agentver/storage'

export {
  ensureStorageDir,
  getLockfilePath,
  getManifestPath,
  getStorageRoot,
  writeJsonFileAtomic,
} from '@agentver/storage'

const TRANSACTION_FILE = 'storage-transaction.json'

export function getStorageTransactionPath(projectRoot: string, scope: Scope = 'project'): string {
  return join(getStorageRoot(projectRoot, scope), TRANSACTION_FILE)
}
