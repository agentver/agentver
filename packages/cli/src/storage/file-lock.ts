import { AgentverError } from '@agentver/shared'
import type { LockOptions, Scope } from '@agentver/storage'
import {
  acquireLock as acquireLockRaw,
  StorageLockError,
  withStorageLock as withStorageLockRaw,
} from '@agentver/storage'

export type FileLockOptions = {
  acquireTimeoutMs?: number
  retryIntervalMs?: number
  staleThresholdMs?: number
}

/** Converts CLI's FileLockOptions to the storage package's LockOptions. */
export function toLockOptions(options: FileLockOptions): LockOptions {
  return {
    mode: 'exclusive',
    acquireTimeoutMs: options.acquireTimeoutMs,
    retryIntervalMs: options.retryIntervalMs,
    staleThresholdMs: options.staleThresholdMs,
  }
}

/**
 * Wraps StorageLockError from @agentver/storage into AgentverError
 * to preserve the CLI's original error contract.
 */
function wrapLockError(error: unknown): never {
  if (error instanceof StorageLockError) {
    throw new AgentverError('CONFLICT', error.message)
  }
  throw error
}

export function acquireLock(
  projectRoot: string,
  scope: Scope = 'project',
  options: FileLockOptions = {}
): () => void {
  try {
    return acquireLockRaw(projectRoot, scope, toLockOptions(options))
  } catch (error) {
    wrapLockError(error)
  }
}

export function withStorageLock<T>(
  projectRoot: string,
  scope: Scope,
  callback: () => T,
  options?: FileLockOptions
): T {
  try {
    return withStorageLockRaw(
      projectRoot,
      scope,
      callback,
      options ? toLockOptions(options) : undefined
    )
  } catch (error) {
    wrapLockError(error)
  }
}
