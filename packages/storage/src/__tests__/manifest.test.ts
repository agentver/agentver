import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ManifestV2 } from '@agentver/shared'
import { STORAGE_SCHEMA_VERSION } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acquireLock,
  readManifest,
  StorageCorruptionError,
  updateManifest,
  writeManifest,
} from '../index'

let tmpDir: string
let agentverDir: string
let manifestPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'agentver-manifest-test-'))
  agentverDir = join(tmpDir, '.agentver')
  manifestPath = join(agentverDir, 'manifest.json')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function writeManifestFile(data: unknown): void {
  mkdirSync(agentverDir, { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(data, null, 2))
}

function makeValidManifest(overrides?: Partial<ManifestV2>): ManifestV2 {
  return {
    version: STORAGE_SCHEMA_VERSION,
    packages: {},
    ...overrides,
  }
}

function makeManifestWithPackage(): ManifestV2 {
  const stableKey = `git:${encodeURIComponent('https://github.com/org/repo.git#skills/test#main')}`
  return {
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
        agents: ['claude-code'],
        installedAt: '2025-01-01T00:00:00.000Z',
        modified: false,
      },
    },
  }
}

// --- readManifest ---

describe('readManifest', () => {
  it('returns empty manifest when file is missing (first run)', () => {
    const result = readManifest(tmpDir, 'project')
    expect(result.data).toEqual({
      version: STORAGE_SCHEMA_VERSION,
      packages: {},
    })
  })

  it('returns valid manifest from well-formed file', () => {
    const manifest = makeManifestWithPackage()
    writeManifestFile(manifest)

    const result = readManifest(tmpDir, 'project')
    expect(result.data.version).toBe(STORAGE_SCHEMA_VERSION)
    expect(Object.keys(result.data.packages).length).toBe(1)
  })

  it('throws StorageCorruptionError on invalid JSON', () => {
    mkdirSync(agentverDir, { recursive: true })
    writeFileSync(manifestPath, '{not valid json')

    expect(() => readManifest(tmpDir, 'project')).toThrow(StorageCorruptionError)

    try {
      readManifest(tmpDir, 'project')
    } catch (error) {
      const corruptionError = error as StorageCorruptionError
      expect(corruptionError.reason).toBe('invalid-json')
      expect(corruptionError.filePath).toBe(manifestPath)
    }
  })

  it('returns empty manifest when schema validation fails', () => {
    writeManifestFile({
      version: STORAGE_SCHEMA_VERSION,
      packages: {
        'bad-only': {
          source: { type: 'invalid' },
        },
      },
    })

    const result = readManifest(tmpDir, 'project')
    expect(result.data).toEqual({
      version: STORAGE_SCHEMA_VERSION,
      packages: {},
    })
  })

  it('does NOT write back to disc (no side-effect writes)', () => {
    const manifest = makeManifestWithPackage()
    writeManifestFile(manifest)
    const contentBefore = readFileSync(manifestPath, 'utf-8')

    readManifest(tmpDir, 'project')

    const contentAfter = readFileSync(manifestPath, 'utf-8')
    expect(contentAfter).toBe(contentBefore)
  })
})

// --- writeManifest ---

describe('writeManifest', () => {
  it('creates .agentver/ directory if missing', () => {
    expect(existsSync(agentverDir)).toBe(false)
    writeManifest(tmpDir, makeValidManifest(), 'project')
    expect(existsSync(agentverDir)).toBe(true)
  })

  it('writes a file that exists after the call', () => {
    writeManifest(tmpDir, makeValidManifest(), 'project')
    expect(existsSync(manifestPath)).toBe(true)
  })

  it('uses deterministic serialisation (sorted keys)', () => {
    const manifest = makeManifestWithPackage()
    writeManifest(tmpDir, manifest, 'project')
    const content = readFileSync(manifestPath, 'utf-8')
    const parsed = JSON.parse(content)
    // Top-level keys should be sorted: packages, version
    expect(Object.keys(parsed)).toEqual(['packages', 'version'])
  })

  it('acquires lock in exclusive mode by default', () => {
    writeManifest(tmpDir, makeValidManifest(), 'project')
    // Lock should be released after write — no lock file left
    const lockPath = join(agentverDir, '.lock')
    expect(existsSync(lockPath)).toBe(false)
  })

  it('advisory lock mode proceeds even if lock is unavailable', () => {
    const release = acquireLock(tmpDir, 'project')

    try {
      expect(() =>
        writeManifest(tmpDir, makeValidManifest(), 'project', { mode: 'advisory' })
      ).not.toThrow()
    } finally {
      release()
    }
  })
})

// --- updateManifest ---

describe('updateManifest', () => {
  it('performs read-modify-write under lock', () => {
    writeManifest(tmpDir, makeValidManifest(), 'project')

    const result = updateManifest(tmpDir, 'project', (manifest) => ({
      ...manifest,
      packages: {
        ...manifest.packages,
        'git:new-key': {
          name: 'new-skill',
          source: {
            type: 'git' as const,
            uri: 'https://github.com/org/repo.git',
            path: 'skills/new',
            ref: 'main',
            commit: 'abc1234',
          },
          agents: ['claude-code'],
          installedAt: '2025-01-01T00:00:00.000Z',
          modified: false,
        },
      },
    }))

    expect(Object.keys(result.packages).length).toBe(1)
    // Verify it was persisted
    const onDisc = readManifest(tmpDir, 'project')
    expect(Object.keys(onDisc.data.packages).length).toBe(1)
  })

  it('updater receives current state', () => {
    const manifest = makeManifestWithPackage()
    writeManifest(tmpDir, manifest, 'project')

    const updaterSpy = vi.fn((m: ManifestV2) => m)
    updateManifest(tmpDir, 'project', updaterSpy)

    expect(updaterSpy).toHaveBeenCalledOnce()
    const received = updaterSpy.mock.calls[0]![0]
    expect(received.version).toBe(STORAGE_SCHEMA_VERSION)
    expect(Object.keys(received.packages).length).toBe(1)
  })

  it('returns updated state', () => {
    writeManifest(tmpDir, makeValidManifest(), 'project')

    const result = updateManifest(tmpDir, 'project', (manifest) => ({
      ...manifest,
      packages: {
        'local:test': {
          name: 'added',
          source: { type: 'local' as const, path: '/tmp/skill' },
          agents: [],
          installedAt: '2025-01-01T00:00:00.000Z',
          modified: false,
        },
      },
    }))

    expect(Object.keys(result.packages).length).toBe(1)
  })
})
