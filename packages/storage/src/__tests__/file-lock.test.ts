import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireLock, StorageLockError, withStorageLock } from '../index'

let tmpDir: string

function getLockFilePath(): string {
  return join(tmpDir, '.agentver', '.lock')
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'agentver-lock-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('acquireLock', () => {
  it('creates a .lock file in exclusive mode', () => {
    const release = acquireLock(tmpDir, 'project', { mode: 'exclusive' })
    try {
      expect(existsSync(getLockFilePath())).toBe(true)
    } finally {
      release()
    }
  })

  it('defaults to exclusive mode when no options provided', () => {
    const release = acquireLock(tmpDir, 'project')
    try {
      expect(existsSync(getLockFilePath())).toBe(true)
    } finally {
      release()
    }
  })

  it('removes .lock file on release', () => {
    const release = acquireLock(tmpDir, 'project')
    expect(existsSync(getLockFilePath())).toBe(true)
    release()
    expect(existsSync(getLockFilePath())).toBe(false)
  })

  it('throws StorageLockError on timeout in exclusive mode', () => {
    const release = acquireLock(tmpDir, 'project')
    try {
      expect(() =>
        acquireLock(tmpDir, 'project', {
          mode: 'exclusive',
          acquireTimeoutMs: 150,
          retryIntervalMs: 50,
        })
      ).toThrow(StorageLockError)
    } finally {
      release()
    }
  })

  it('includes holder PID and timeout in the error', () => {
    const release = acquireLock(tmpDir, 'project')
    try {
      let caughtError: StorageLockError | undefined
      try {
        acquireLock(tmpDir, 'project', {
          mode: 'exclusive',
          acquireTimeoutMs: 150,
          retryIntervalMs: 50,
        })
      } catch (error) {
        caughtError = error as StorageLockError
      }

      expect(caughtError).toBeInstanceOf(StorageLockError)
      expect(caughtError!.holderPid).toBe(process.pid)
      expect(caughtError!.timeoutMs).toBe(150)
      expect(caughtError!.lockPath).toBe(getLockFilePath())
    } finally {
      release()
    }
  })

  describe('advisory mode', () => {
    it('proceeds without error when lock is held by another acquisition', () => {
      const release = acquireLock(tmpDir, 'project')
      try {
        const advisoryRelease = acquireLock(tmpDir, 'project', { mode: 'advisory' })
        // Should not throw — advisory mode proceeds without the lock
        advisoryRelease()
      } finally {
        release()
      }
    })

    it('acquires the lock when no contention', () => {
      const release = acquireLock(tmpDir, 'project', { mode: 'advisory' })
      try {
        expect(existsSync(getLockFilePath())).toBe(true)
      } finally {
        release()
      }
    })
  })

  describe('none mode', () => {
    it('returns immediately without creating a lock file', () => {
      const release = acquireLock(tmpDir, 'project', { mode: 'none' })
      expect(existsSync(getLockFilePath())).toBe(false)
      release()
    })

    it('release is a no-op', () => {
      const release = acquireLock(tmpDir, 'project', { mode: 'none' })
      expect(() => release()).not.toThrow()
    })
  })

  describe('stale lock detection', () => {
    it('reclaims a lock from a dead process (non-existent PID)', () => {
      const agentverDir = join(tmpDir, '.agentver')
      rmSync(agentverDir, { recursive: true, force: true })
      mkdirSync(agentverDir, { recursive: true })

      writeFileSync(getLockFilePath(), JSON.stringify({ pid: 999999999, createdAt: Date.now() }))

      const release = acquireLock(tmpDir, 'project', { acquireTimeoutMs: 1000 })
      try {
        const raw = readFileSync(getLockFilePath(), 'utf-8')
        const payload = JSON.parse(raw) as { pid: number }
        expect(payload.pid).toBe(process.pid)
      } finally {
        release()
      }
    })

    it('reclaims a lock that exceeds the stale threshold', () => {
      const agentverDir = join(tmpDir, '.agentver')
      rmSync(agentverDir, { recursive: true, force: true })
      mkdirSync(agentverDir, { recursive: true })

      writeFileSync(
        getLockFilePath(),
        JSON.stringify({ pid: process.pid, createdAt: Date.now() - 60_000 })
      )

      const release = acquireLock(tmpDir, 'project', {
        staleThresholdMs: 1000,
        acquireTimeoutMs: 2000,
      })
      try {
        expect(existsSync(getLockFilePath())).toBe(true)
      } finally {
        release()
      }
    })
  })

  it('release is idempotent — calling twice does not throw', () => {
    const release = acquireLock(tmpDir, 'project')
    release()
    expect(() => release()).not.toThrow()
  })
})

describe('withStorageLock', () => {
  it('executes callback and returns its result', () => {
    const result = withStorageLock(tmpDir, 'project', () => 42)
    expect(result).toBe(42)
  })

  it('releases lock after callback completes', () => {
    withStorageLock(tmpDir, 'project', () => {
      expect(existsSync(getLockFilePath())).toBe(true)
    })
    expect(existsSync(getLockFilePath())).toBe(false)
  })

  it('releases lock even when callback throws', () => {
    expect(() =>
      withStorageLock(tmpDir, 'project', () => {
        throw new Error('boom')
      })
    ).toThrow('boom')

    expect(existsSync(getLockFilePath())).toBe(false)
  })

  it('allows re-acquisition after an error in the callback', () => {
    try {
      withStorageLock(tmpDir, 'project', () => {
        throw new Error('oops')
      })
    } catch {
      // expected
    }

    const result = withStorageLock(tmpDir, 'project', () => 'recovered')
    expect(result).toBe('recovered')
  })
})
