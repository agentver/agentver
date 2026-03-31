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
import { serialiseDeterministic } from '../serialise'

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
    expect(result.dirty).toBe(false)
    expect(result.droppedEntries).toEqual([])
  })

  it('returns valid manifest from well-formed file', () => {
    const manifest = makeManifestWithPackage()
    writeManifestFile(manifest)

    const result = readManifest(tmpDir, 'project')
    expect(result.data.version).toBe(STORAGE_SCHEMA_VERSION)
    expect(Object.keys(result.data.packages).length).toBe(1)
  })

  it('returns dirty: false when file is already normalised', () => {
    // Use the stable key that normalisation would produce, including the name field
    const stableKey = `git:${encodeURIComponent('https://github.com/org/repo.git#skills/test')}`
    const manifest: ManifestV2 = {
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
    mkdirSync(agentverDir, { recursive: true })
    writeFileSync(manifestPath, serialiseDeterministic(manifest))

    const result = readManifest(tmpDir, 'project')
    expect(result.dirty).toBe(false)
  })

  it('returns dirty: true when normalisation changes data', () => {
    // Write a manifest with an old-style key that normalisation will rewrite
    const manifest = {
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
          agents: ['claude-code'],
          installedAt: '2025-01-01T00:00:00.000Z',
          modified: false,
        },
      },
    }
    writeManifestFile(manifest)

    const result = readManifest(tmpDir, 'project')
    // The key will be rewritten to a stable key, so dirty should be true
    expect(result.dirty).toBe(true)
  })

  it('reports droppedEntries when per-entry recovery kicks in', () => {
    const manifest = {
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
          agents: ['claude-code'],
          installedAt: '2025-01-01T00:00:00.000Z',
          modified: false,
        },
        'bad-entry': {
          // Missing required fields — this entry is invalid
          name: 'bad-skill',
          source: { type: 'invalid-type' },
        },
      },
    }
    // Write raw JSON so the whole-manifest parse fails but per-entry recovery works
    mkdirSync(agentverDir, { recursive: true })
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    const warnings: string[] = []
    const result = readManifest(tmpDir, 'project', {
      onWarning: (msg) => warnings.push(msg),
    })

    expect(result.dirty).toBe(true)
    expect(result.droppedEntries.length).toBeGreaterThan(0)
    expect(result.droppedEntries.some((e) => e.key === 'bad-entry')).toBe(true)
    expect(warnings.length).toBeGreaterThan(0)
    // The good entry should still be in the data
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

  it('throws StorageCorruptionError when schema validation fails completely', () => {
    // A file that is valid JSON but has zero recoverable entries
    writeManifestFile({
      version: STORAGE_SCHEMA_VERSION,
      packages: {
        'bad-only': {
          source: { type: 'invalid' },
        },
      },
    })

    expect(() => readManifest(tmpDir, 'project')).toThrow(StorageCorruptionError)

    try {
      readManifest(tmpDir, 'project')
    } catch (error) {
      const corruptionError = error as StorageCorruptionError
      expect(corruptionError.reason).toBe('schema-validation-failed')
    }
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
