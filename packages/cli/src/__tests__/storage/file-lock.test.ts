import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireLock, withStorageLock } from '../../storage/file-lock'

const TEST_ROOT = join(tmpdir(), `agentver-lock-test-${process.pid}`)
const LOCK_PATH = join(TEST_ROOT, '.agentver', '.lock')

function ensureClean(): void {
  rmSync(TEST_ROOT, { recursive: true, force: true })
  mkdirSync(join(TEST_ROOT, '.agentver'), { recursive: true })
}

describe('storage/file-lock', () => {
  beforeEach(() => {
    ensureClean()
  })

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  describe('acquireLock', () => {
    it('creates a lock file on acquisition', () => {
      const release = acquireLock(TEST_ROOT, 'project')
      try {
        expect(existsSync(LOCK_PATH)).toBe(true)
      } finally {
        release()
      }
    })

    it('lock file contains PID and timestamp', () => {
      const release = acquireLock(TEST_ROOT, 'project')
      try {
        const raw = readFileSync(LOCK_PATH, 'utf-8')
        const payload = JSON.parse(raw) as { pid: number; createdAt: number }
        expect(payload.pid).toBe(process.pid)
        expect(typeof payload.createdAt).toBe('number')
        expect(payload.createdAt).toBeLessThanOrEqual(Date.now())
      } finally {
        release()
      }
    })

    it('removes the lock file on release', () => {
      const release = acquireLock(TEST_ROOT, 'project')
      expect(existsSync(LOCK_PATH)).toBe(true)
      release()
      expect(existsSync(LOCK_PATH)).toBe(false)
    })

    it('release is idempotent — calling twice does not throw', () => {
      const release = acquireLock(TEST_ROOT, 'project')
      release()
      expect(() => release()).not.toThrow()
    })

    it('creates the .agentver directory if it does not exist', () => {
      rmSync(join(TEST_ROOT, '.agentver'), { recursive: true, force: true })

      const release = acquireLock(TEST_ROOT, 'project')
      try {
        expect(existsSync(join(TEST_ROOT, '.agentver'))).toBe(true)
        expect(existsSync(LOCK_PATH)).toBe(true)
      } finally {
        release()
      }
    })

    it('sequential lock acquisitions succeed (no leftover state)', () => {
      const release1 = acquireLock(TEST_ROOT, 'project')
      release1()

      const release2 = acquireLock(TEST_ROOT, 'project')
      release2()

      expect(existsSync(LOCK_PATH)).toBe(false)
    })
  })

  describe('stale lock detection', () => {
    it('reclaims a lock from a dead process', () => {
      // Write a lock file pretending to be from a non-existent PID
      writeFileSync(LOCK_PATH, JSON.stringify({ pid: 999999999, createdAt: Date.now() }))

      const release = acquireLock(TEST_ROOT, 'project', { acquireTimeoutMs: 1000 })
      try {
        const raw = readFileSync(LOCK_PATH, 'utf-8')
        const payload = JSON.parse(raw) as { pid: number }
        expect(payload.pid).toBe(process.pid)
      } finally {
        release()
      }
    })

    it('reclaims a lock that has exceeded the stale threshold', () => {
      // Lock from our own PID (alive) but with a very old timestamp
      writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, createdAt: Date.now() - 60_000 }))

      const release = acquireLock(TEST_ROOT, 'project', {
        staleThresholdMs: 1000,
        acquireTimeoutMs: 2000,
      })
      try {
        expect(existsSync(LOCK_PATH)).toBe(true)
      } finally {
        release()
      }
    })

    it('times out on corrupt lock file content', () => {
      writeFileSync(LOCK_PATH, 'not-json-at-all')

      expect(() =>
        acquireLock(TEST_ROOT, 'project', { acquireTimeoutMs: 200, retryIntervalMs: 50 })
      ).toThrow('Could not acquire storage lock')
    })
  })

  describe('contention', () => {
    it('throws CONFLICT after timeout when lock is held by a live process', () => {
      const release = acquireLock(TEST_ROOT, 'project')
      try {
        expect(() =>
          acquireLock(TEST_ROOT, 'project', {
            acquireTimeoutMs: 200,
            retryIntervalMs: 50,
          })
        ).toThrow('Could not acquire storage lock')
      } finally {
        release()
      }
    })

    it('error message includes the holder PID', () => {
      const release = acquireLock(TEST_ROOT, 'project')
      try {
        expect(() =>
          acquireLock(TEST_ROOT, 'project', {
            acquireTimeoutMs: 200,
            retryIntervalMs: 50,
          })
        ).toThrow(`pid ${process.pid}`)
      } finally {
        release()
      }
    })

    it('error is an AgentverError with CONFLICT code', () => {
      const release = acquireLock(TEST_ROOT, 'project')
      try {
        let caughtError: unknown
        try {
          acquireLock(TEST_ROOT, 'project', {
            acquireTimeoutMs: 200,
            retryIntervalMs: 50,
          })
        } catch (error) {
          caughtError = error
        }

        expect(caughtError).toBeDefined()
        const err = caughtError as { code: string; name: string }
        expect(err.name).toBe('AgentverError')
        expect(err.code).toBe('CONFLICT')
      } finally {
        release()
      }
    })
  })

  describe('withStorageLock', () => {
    it('returns the callback result', () => {
      const result = withStorageLock(TEST_ROOT, 'project', () => 42)
      expect(result).toBe(42)
    })

    it('releases the lock after the callback completes', () => {
      withStorageLock(TEST_ROOT, 'project', () => {
        expect(existsSync(LOCK_PATH)).toBe(true)
      })
      expect(existsSync(LOCK_PATH)).toBe(false)
    })

    it('releases the lock even when the callback throws', () => {
      expect(() =>
        withStorageLock(TEST_ROOT, 'project', () => {
          throw new Error('boom')
        })
      ).toThrow('boom')

      expect(existsSync(LOCK_PATH)).toBe(false)
    })

    it('allows re-acquisition after an error in the callback', () => {
      try {
        withStorageLock(TEST_ROOT, 'project', () => {
          throw new Error('oops')
        })
      } catch {
        // expected
      }

      const result = withStorageLock(TEST_ROOT, 'project', () => 'recovered')
      expect(result).toBe('recovered')
    })

    it('lock is held during the entire callback execution', () => {
      let lockHeldDuringOperation = false

      withStorageLock(TEST_ROOT, 'project', () => {
        lockHeldDuringOperation = existsSync(LOCK_PATH)
      })

      expect(lockHeldDuringOperation).toBe(true)
      expect(existsSync(LOCK_PATH)).toBe(false)
    })
  })
})
