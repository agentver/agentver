import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LockfileV2 } from '@agentver/shared'
import { STORAGE_SCHEMA_VERSION } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acquireLock,
  readLockfile,
  StorageCorruptionError,
  updateLockfile,
  writeLockfile,
} from '../index'
import { serialiseDeterministic } from '../serialise'

let tmpDir: string
let agentverDir: string
let lockfilePath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'agentver-lockfile-test-'))
  agentverDir = join(tmpDir, '.agentver')
  lockfilePath = join(agentverDir, 'lockfile.json')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function writeLockfileFile(data: unknown): void {
  mkdirSync(agentverDir, { recursive: true })
  writeFileSync(lockfilePath, JSON.stringify(data, null, 2))
}

function makeValidLockfile(overrides?: Partial<LockfileV2>): LockfileV2 {
  return {
    version: STORAGE_SCHEMA_VERSION,
    packages: {},
    ...overrides,
  }
}

function makeLockfileWithPackage(): LockfileV2 {
  return {
    version: STORAGE_SCHEMA_VERSION,
    packages: {
      'git:test-key': {
        name: 'test-skill',
        source: {
          type: 'git',
          uri: 'https://github.com/org/repo.git',
          path: 'skills/test',
          ref: 'main',
          commit: 'abc1234',
        },
        integrity: 'sha256-dGVzdA==',
        agents: ['claude-code'],
      },
    },
  }
}

// --- readLockfile ---

describe('readLockfile', () => {
  it('returns empty lockfile when file is missing (first run)', () => {
    const result = readLockfile(tmpDir, 'project')
    expect(result.data).toEqual({
      version: STORAGE_SCHEMA_VERSION,
      packages: {},
    })
    expect(result.dirty).toBe(false)
    expect(result.droppedEntries).toEqual([])
  })

  it('returns valid lockfile from well-formed file', () => {
    const lockfile = makeLockfileWithPackage()
    writeLockfileFile(lockfile)

    const result = readLockfile(tmpDir, 'project')
    expect(result.data.version).toBe(STORAGE_SCHEMA_VERSION)
    expect(Object.keys(result.data.packages).length).toBe(1)
  })

  it('returns dirty: false when file is already normalised', () => {
    const stableKey = `git:${encodeURIComponent('https://github.com/org/repo.git#skills/test')}`
    const lockfile: LockfileV2 = {
      version: STORAGE_SCHEMA_VERSION,
      packages: {
        [stableKey]: {
          name: 'test-skill',
          source: {
            type: 'git',
            uri: 'https://github.com/org/repo.git',
            path: 'skills/test',
            ref: 'main',
            commit: 'abc1234',
          },
          integrity: 'sha256-dGVzdA==',
          agents: ['claude-code'],
        },
      },
    }
    mkdirSync(agentverDir, { recursive: true })
    writeFileSync(lockfilePath, serialiseDeterministic(lockfile))

    const result = readLockfile(tmpDir, 'project')
    expect(result.dirty).toBe(false)
  })

  it('returns dirty: true when normalisation changes data', () => {
    const lockfile = {
      version: STORAGE_SCHEMA_VERSION,
      packages: {
        'old-style-key': {
          name: 'test-skill',
          source: {
            type: 'git' as const,
            uri: 'https://github.com/org/repo.git',
            path: 'skills/test',
            ref: 'main',
            commit: 'abc1234',
          },
          integrity: 'sha256-dGVzdA==',
          agents: ['claude-code'],
        },
      },
    }
    writeLockfileFile(lockfile)

    const result = readLockfile(tmpDir, 'project')
    expect(result.dirty).toBe(true)
  })

  it('reports droppedEntries when per-entry recovery kicks in', () => {
    const lockfile = {
      version: STORAGE_SCHEMA_VERSION,
      packages: {
        'good-entry': {
          name: 'good-skill',
          source: {
            type: 'git',
            uri: 'https://github.com/org/repo.git',
            path: 'skills/good',
            ref: 'main',
            commit: 'abc1234',
          },
          integrity: 'sha256-dGVzdA==',
          agents: ['claude-code'],
        },
        'bad-entry': {
          name: 'bad-skill',
          source: { type: 'invalid-type' },
          integrity: 'not-valid',
        },
      },
    }
    mkdirSync(agentverDir, { recursive: true })
    writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2))

    const warnings: string[] = []
    const result = readLockfile(tmpDir, 'project', {
      onWarning: (msg) => warnings.push(msg),
    })

    expect(result.dirty).toBe(true)
    expect(result.droppedEntries.length).toBeGreaterThan(0)
    expect(result.droppedEntries.some((e) => e.key === 'bad-entry')).toBe(true)
    expect(warnings.length).toBeGreaterThan(0)
    expect(Object.keys(result.data.packages).length).toBe(1)
  })

  it('throws StorageCorruptionError on invalid JSON', () => {
    mkdirSync(agentverDir, { recursive: true })
    writeFileSync(lockfilePath, 'not-valid-json{{{')

    expect(() => readLockfile(tmpDir, 'project')).toThrow(StorageCorruptionError)

    try {
      readLockfile(tmpDir, 'project')
    } catch (error) {
      const corruptionError = error as StorageCorruptionError
      expect(corruptionError.reason).toBe('invalid-json')
      expect(corruptionError.filePath).toBe(lockfilePath)
    }
  })

  it('throws StorageCorruptionError when schema validation fails completely', () => {
    writeLockfileFile({
      version: STORAGE_SCHEMA_VERSION,
      packages: {
        'bad-only': {
          source: { type: 'totally-wrong' },
        },
      },
    })

    expect(() => readLockfile(tmpDir, 'project')).toThrow(StorageCorruptionError)

    try {
      readLockfile(tmpDir, 'project')
    } catch (error) {
      const corruptionError = error as StorageCorruptionError
      expect(corruptionError.reason).toBe('schema-validation-failed')
    }
  })

  it('does NOT write back to disc (no side-effect writes)', () => {
    const lockfile = makeLockfileWithPackage()
    writeLockfileFile(lockfile)
    const contentBefore = readFileSync(lockfilePath, 'utf-8')

    readLockfile(tmpDir, 'project')

    const contentAfter = readFileSync(lockfilePath, 'utf-8')
    expect(contentAfter).toBe(contentBefore)
  })
})

// --- writeLockfile ---

describe('writeLockfile', () => {
  it('creates .agentver/ directory if missing', () => {
    expect(existsSync(agentverDir)).toBe(false)
    writeLockfile(tmpDir, makeValidLockfile(), 'project')
    expect(existsSync(agentverDir)).toBe(true)
  })

  it('writes a file that exists after the call', () => {
    writeLockfile(tmpDir, makeValidLockfile(), 'project')
    expect(existsSync(lockfilePath)).toBe(true)
  })

  it('uses deterministic serialisation (sorted keys)', () => {
    const lockfile = makeLockfileWithPackage()
    writeLockfile(tmpDir, lockfile, 'project')
    const content = readFileSync(lockfilePath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(Object.keys(parsed)).toEqual(['packages', 'version'])
  })

  it('acquires lock in exclusive mode by default', () => {
    writeLockfile(tmpDir, makeValidLockfile(), 'project')
    const lockPath = join(agentverDir, '.lock')
    expect(existsSync(lockPath)).toBe(false)
  })

  it('advisory lock mode proceeds even if lock is unavailable', () => {
    const release = acquireLock(tmpDir, 'project')

    try {
      expect(() =>
        writeLockfile(tmpDir, makeValidLockfile(), 'project', { mode: 'advisory' })
      ).not.toThrow()
    } finally {
      release()
    }
  })
})

// --- updateLockfile ---

describe('updateLockfile', () => {
  it('performs read-modify-write under lock', () => {
    writeLockfile(tmpDir, makeValidLockfile(), 'project')

    const result = updateLockfile(tmpDir, 'project', (lockfile) => ({
      ...lockfile,
      packages: {
        ...lockfile.packages,
        'git:new-key': {
          name: 'new-skill',
          source: {
            type: 'git' as const,
            uri: 'https://github.com/org/repo.git',
            path: 'skills/new',
            ref: 'main',
            commit: 'abc1234',
          },
          integrity: 'sha256-bmV3',
          agents: ['claude-code'],
        },
      },
    }))

    expect(Object.keys(result.packages).length).toBe(1)
    const onDisc = readLockfile(tmpDir, 'project')
    expect(Object.keys(onDisc.data.packages).length).toBe(1)
  })

  it('updater receives current state', () => {
    const lockfile = makeLockfileWithPackage()
    writeLockfile(tmpDir, lockfile, 'project')

    const updaterSpy = vi.fn((lf: LockfileV2) => lf)
    updateLockfile(tmpDir, 'project', updaterSpy)

    expect(updaterSpy).toHaveBeenCalledOnce()
    const received = updaterSpy.mock.calls[0]![0]
    expect(received.version).toBe(STORAGE_SCHEMA_VERSION)
    expect(Object.keys(received.packages).length).toBe(1)
  })

  it('returns updated state', () => {
    writeLockfile(tmpDir, makeValidLockfile(), 'project')

    const result = updateLockfile(tmpDir, 'project', (lockfile) => ({
      ...lockfile,
      packages: {
        'local:test': {
          name: 'added',
          source: { type: 'local' as const, path: '/tmp/skill' },
          integrity: 'sha256-YWRkZWQ=',
          agents: [],
        },
      },
    }))

    expect(Object.keys(result.packages).length).toBe(1)
  })
})
