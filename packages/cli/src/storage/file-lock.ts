import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AgentverError } from '@agentver/shared'
import type { Scope } from '../utils/paths'
import { createCliLogger } from '../utils.js'

const logger = createCliLogger('file-lock')

const AGENTVER_DIR = '.agentver'
const LOCK_FILENAME = '.lock'

/** Default timeout (ms) before giving up on acquiring the lock. */
const DEFAULT_ACQUIRE_TIMEOUT_MS = 10_000

/** Interval (ms) between acquisition retry attempts. */
const DEFAULT_RETRY_INTERVAL_MS = 50

/**
 * Age (ms) after which a lock file is considered stale and can be reclaimed.
 * Covers slow machines and large operations with a generous margin.
 */
const DEFAULT_STALE_THRESHOLD_MS = 30_000

export type FileLockOptions = {
  acquireTimeoutMs?: number
  retryIntervalMs?: number
  staleThresholdMs?: number
}

type LockPayload = {
  pid: number
  createdAt: number
}

function getLockDir(projectRoot: string, scope: Scope): string {
  if (scope === 'global') {
    return join(homedir(), AGENTVER_DIR)
  }
  return join(projectRoot, AGENTVER_DIR)
}

function getLockPath(projectRoot: string, scope: Scope): string {
  return join(getLockDir(projectRoot, scope), LOCK_FILENAME)
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

function isLockStale(payload: LockPayload, staleThresholdMs: number): boolean {
  if (!isProcessAlive(payload.pid)) {
    return true
  }
  return Date.now() - payload.createdAt > staleThresholdMs
}

/**
 * Attempts to acquire a filesystem lock for the .agentver directory.
 *
 * Uses exclusive file creation (wx flag) to prevent races. If the lock
 * file already exists, checks whether the owning process is still alive
 * and whether the lock is stale. Retries with a short interval up to
 * the configured timeout.
 *
 * Returns a release function that must be called when the critical
 * section is complete (including in error paths).
 */
export function acquireLock(
  projectRoot: string,
  scope: Scope = 'project',
  options: FileLockOptions = {}
): () => void {
  const {
    acquireTimeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS,
    retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
    staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS,
  } = options

  const lockDir = getLockDir(projectRoot, scope)
  const lockPath = getLockPath(projectRoot, scope)

  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true })
  }

  const payload: LockPayload = {
    pid: process.pid,
    createdAt: Date.now(),
  }
  const payloadStr = JSON.stringify(payload)

  const deadline = Date.now() + acquireTimeoutMs

  while (true) {
    try {
      // 'wx' flag: exclusive creation — fails if the file already exists
      writeFileSync(lockPath, payloadStr, { flag: 'wx' })
      logger.debug(`Lock acquired at ${lockPath} (pid ${process.pid})`)
      return createRelease(lockPath)
    } catch (error: unknown) {
      // If the error isn't EEXIST, it's an unexpected filesystem error
      if (!isEexistError(error)) {
        throw error
      }
    }

    // Lock file exists — check whether it's stale
    const existing = readLockPayload(lockPath)

    if (existing && isLockStale(existing, staleThresholdMs)) {
      logger.warn(
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
      const holderInfo = existing ? ` (held by pid ${existing.pid})` : ''
      throw new AgentverError(
        'CONFLICT',
        `Could not acquire storage lock at ${lockPath}${holderInfo}. ` +
          'Another agentver process may be running. ' +
          `If this is a mistake, remove the lock file manually: ${lockPath}`
      )
    }

    // Synchronous sleep using Atomics.wait on a shared buffer
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
  options?: FileLockOptions
): T {
  const release = acquireLock(projectRoot, scope, options)
  try {
    return callback()
  } finally {
    release()
  }
}

function createRelease(lockPath: string): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    try {
      rmSync(lockPath, { force: true })
      logger.debug(`Lock released at ${lockPath}`)
    } catch (error) {
      logger.warn(`Failed to release lock at ${lockPath}: ${String(error)}`)
    }
  }
}

function isEexistError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: string }).code === 'EEXIST'
  )
}
