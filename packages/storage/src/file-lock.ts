import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { StorageLockError } from './errors'
import { getLockPath, getStorageRoot } from './files'
import type { LockMode, LockOptions, Scope, StorageCallbacks } from './types'

/** Default timeout (ms) before giving up on acquiring the lock. */
const DEFAULT_ACQUIRE_TIMEOUT_MS = 10_000

/** Interval (ms) between acquisition retry attempts. */
const DEFAULT_RETRY_INTERVAL_MS = 50

/**
 * Age (ms) after which a lock file is considered stale and can be reclaimed.
 * Covers slow machines and large operations with a generous margin.
 */
const DEFAULT_STALE_THRESHOLD_MS = 30_000

type LockPayload = {
  pid: number
  createdAt: number
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLockPayload(lockPath: string): LockPayload | null {
  try {
    const raw = readFileSync(lockPath, 'utf-8')
    const parsed = JSON.parse(raw) as LockPayload
    if (typeof parsed.pid === 'number' && typeof parsed.createdAt === 'number') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

function isLockStale(payload: LockPayload, _staleThresholdMs: number): boolean {
  if (!isProcessAlive(payload.pid)) {
    return true
  }
  return false
}

function isEexistError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: string }).code === 'EEXIST'
  )
}

function createRelease(lockPath: string, callbacks?: StorageCallbacks): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    try {
      rmSync(lockPath, { force: true })
      callbacks?.onDebug?.(`Lock released at ${lockPath}`)
    } catch (error) {
      callbacks?.onWarning?.(`Failed to release lock at ${lockPath}: ${String(error)}`)
    }
  }
}

/**
 * Attempts to acquire a filesystem lock for the .agentver directory.
 *
 * Uses exclusive file creation (wx flag) to prevent races. If the lock
 * file already exists, checks whether the owning process is still alive
 * and whether the lock is stale. Retries with a short interval up to
 * the configured timeout.
 *
 * The `mode` field in `options` controls concurrency behaviour:
 * - `exclusive`: block and retry until timeout, throw on failure
 * - `advisory`: one attempt, no retry, proceed without lock on contention
 * - `none`: no-op, returns immediately
 *
 * Returns a release function that must be called when the critical
 * section is complete (including in error paths).
 */
export function acquireLock(
  projectRoot: string,
  scope: Scope = 'project',
  options?: LockOptions,
  callbacks?: StorageCallbacks
): () => void {
  const mode: LockMode = options?.mode ?? 'exclusive'

  if (mode === 'none') {
    return () => {}
  }

  const {
    acquireTimeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS,
    retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
    staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS,
  } = options ?? {}

  const lockDir = getStorageRoot(projectRoot, scope)
  const lockPath = getLockPath(projectRoot, scope)

  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true })
  }

  const payload: LockPayload = {
    pid: process.pid,
    createdAt: Date.now(),
  }
  const payloadStr = JSON.stringify(payload)

  // Advisory mode: single attempt with zero timeout
  const effectiveTimeout = mode === 'advisory' ? 0 : acquireTimeoutMs
  const deadline = Date.now() + effectiveTimeout

  while (true) {
    try {
      writeFileSync(lockPath, payloadStr, { flag: 'wx' })
      callbacks?.onDebug?.(`Lock acquired at ${lockPath} (pid ${process.pid})`)
      return createRelease(lockPath, callbacks)
    } catch (error: unknown) {
      if (!isEexistError(error)) {
        throw error
      }
    }

    const existing = readLockPayload(lockPath)

    if (existing && isLockStale(existing, staleThresholdMs)) {
      callbacks?.onWarning?.(
        `Reclaiming stale lock at ${lockPath} (held by pid ${existing.pid}, ` +
          `created ${Date.now() - existing.createdAt}ms ago)`
      )
      try {
        rmSync(lockPath, { force: true })
      } catch {
        // Another process might have already cleaned it up
      }
      continue
    }

    if (Date.now() >= deadline) {
      if (mode === 'advisory') {
        callbacks?.onWarning?.(
          `Could not acquire advisory lock at ${lockPath}` +
            (existing ? ` (held by pid ${existing.pid})` : '') +
            ' — proceeding without lock'
        )
        return () => {}
      }

      throw new StorageLockError(lockPath, existing?.pid, acquireTimeoutMs)
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryIntervalMs)
  }
}

/**
 * Executes a callback while holding the storage lock.
 * The lock is always released, even if the callback throws.
 */
export function withStorageLock<T>(
  projectRoot: string,
  scope: Scope,
  callback: () => T,
  options?: LockOptions,
  callbacks?: StorageCallbacks
): T {
  const release = acquireLock(projectRoot, scope, options, callbacks)
  try {
    return callback()
  } finally {
    release()
  }
}
