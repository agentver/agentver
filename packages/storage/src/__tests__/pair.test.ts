import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import { STORAGE_SCHEMA_VERSION } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readLockfile,
  readManifest,
  updateManifestAndLockfile,
  writeLockfile,
  writeManifest,
} from '../index'

let tmpDir: string
let agentverDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'agentver-pair-test-'))
  agentverDir = join(tmpDir, '.agentver')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function seedFiles(): { manifest: ManifestV2; lockfile: LockfileV2 } {
  const manifest: ManifestV2 = {
    version: STORAGE_SCHEMA_VERSION,
    packages: {
      'git:existing': {
        name: 'existing-skill',
        source: {
          type: 'git',
          uri: 'https://github.com/org/repo.git',
          path: 'skills/existing',
          ref: 'main',
          commit: 'abc1234',
        },
        agents: ['claude-code'],
        installedAt: '2025-01-01T00:00:00.000Z',
        modified: false,
      },
    },
  }
  const lockfile: LockfileV2 = {
    version: STORAGE_SCHEMA_VERSION,
    packages: {
      'git:existing': {
        name: 'existing-skill',
        source: {
          type: 'git',
          uri: 'https://github.com/org/repo.git',
          path: 'skills/existing',
          ref: 'main',
          commit: 'abc1234',
        },
        integrity: 'sha256-dGVzdA==',
        agents: ['claude-code'],
      },
    },
  }

  writeManifest(tmpDir, manifest, 'project')
  writeLockfile(tmpDir, lockfile, 'project')
  return { manifest, lockfile }
}

describe('updateManifestAndLockfile', () => {
  it('reads both files, passes to updater, writes both', () => {
    seedFiles()

    const updaterSpy = vi.fn((manifest: ManifestV2, lockfile: LockfileV2) => ({
      manifest,
      lockfile,
    }))

    updateManifestAndLockfile(tmpDir, 'project', updaterSpy)

    expect(updaterSpy).toHaveBeenCalledOnce()
    const [receivedManifest, receivedLockfile] = updaterSpy.mock.calls[0]!
    expect(receivedManifest.version).toBe(STORAGE_SCHEMA_VERSION)
    expect(receivedLockfile.version).toBe(STORAGE_SCHEMA_VERSION)
    expect(Object.keys(receivedManifest.packages).length).toBe(1)
    expect(Object.keys(receivedLockfile.packages).length).toBe(1)
  })

  it('creates transaction journal before writing and deletes it after success', () => {
    seedFiles()
    const transactionPath = join(agentverDir, 'storage-transaction.json')

    updateManifestAndLockfile(tmpDir, 'project', (manifest, lockfile) => ({ manifest, lockfile }))

    // Journal should be cleaned up after successful write
    expect(existsSync(transactionPath)).toBe(false)
  })

  it('updater receives normalised state', () => {
    seedFiles()

    updateManifestAndLockfile(tmpDir, 'project', (manifest, lockfile) => {
      // Should receive v2 normalised data
      expect(manifest.version).toBe(STORAGE_SCHEMA_VERSION)
      expect(lockfile.version).toBe(STORAGE_SCHEMA_VERSION)
      return { manifest, lockfile }
    })
  })

  it('returns updated state', () => {
    seedFiles()

    const newEntry = {
      name: 'new-skill',
      source: {
        type: 'local' as const,
        path: '/tmp/new-skill',
      },
      agents: [] as string[],
      installedAt: '2025-06-01T00:00:00.000Z',
      modified: false,
    }

    const result = updateManifestAndLockfile(tmpDir, 'project', (manifest, lockfile) => ({
      manifest: {
        ...manifest,
        packages: {
          ...manifest.packages,
          'local:new': newEntry,
        },
      },
      lockfile: {
        ...lockfile,
        packages: {
          ...lockfile.packages,
          'local:new': {
            name: 'new-skill',
            source: { type: 'local' as const, path: '/tmp/new-skill' },
            integrity: 'sha256-bmV3',
            agents: [],
          },
        },
      },
    }))

    expect(Object.keys(result.manifest.packages).length).toBe(2)
    expect(Object.keys(result.lockfile.packages).length).toBe(2)
  })

  it('persists both files to disc', () => {
    seedFiles()

    updateManifestAndLockfile(tmpDir, 'project', (manifest, lockfile) => ({
      manifest: {
        ...manifest,
        packages: {
          ...manifest.packages,
          'local:added': {
            name: 'added',
            source: { type: 'local' as const, path: '/tmp/added' },
            agents: [],
            installedAt: '2025-01-01T00:00:00.000Z',
            modified: false,
          },
        },
      },
      lockfile: {
        ...lockfile,
        packages: {
          ...lockfile.packages,
          'local:added': {
            name: 'added',
            source: { type: 'local' as const, path: '/tmp/added' },
            integrity: 'sha256-YWRk',
            agents: [],
          },
        },
      },
    }))

    const manifestOnDisc = readManifest(tmpDir, 'project')
    const lockfileOnDisc = readLockfile(tmpDir, 'project')
    expect(Object.keys(manifestOnDisc.data.packages).length).toBe(2)
    expect(Object.keys(lockfileOnDisc.data.packages).length).toBe(2)
  })

  it('propagates updater errors without corrupting existing files', () => {
    seedFiles()
    const lockPath = join(agentverDir, '.lock')
    const transactionPath = join(agentverDir, 'storage-transaction.json')

    // Snapshot normalised state before the failing call
    const manifestBefore = readManifest(tmpDir, 'project')
    const lockfileBefore = readLockfile(tmpDir, 'project')

    expect(() =>
      updateManifestAndLockfile(tmpDir, 'project', () => {
        throw new Error('updater kaboom')
      })
    ).toThrowError('updater kaboom')

    // Lock must be released
    expect(existsSync(lockPath)).toBe(false)

    // No transaction journal left behind
    expect(existsSync(transactionPath)).toBe(false)

    // Original files must be intact
    const manifestAfter = readManifest(tmpDir, 'project')
    const lockfileAfter = readLockfile(tmpDir, 'project')
    expect(manifestAfter.data).toEqual(manifestBefore.data)
    expect(lockfileAfter.data).toEqual(lockfileBefore.data)
  })

  it('works on a fresh project with no existing files', () => {
    const result = updateManifestAndLockfile(tmpDir, 'project', (manifest, lockfile) => ({
      manifest: {
        ...manifest,
        packages: {
          'local:first': {
            name: 'first',
            source: { type: 'local' as const, path: '/tmp/first' },
            agents: [],
            installedAt: '2025-01-01T00:00:00.000Z',
            modified: false,
          },
        },
      },
      lockfile: {
        ...lockfile,
        packages: {
          'local:first': {
            name: 'first',
            source: { type: 'local' as const, path: '/tmp/first' },
            integrity: 'sha256-Zmlyc3Q=',
            agents: [],
          },
        },
      },
    }))

    expect(Object.keys(result.manifest.packages).length).toBe(1)
    expect(Object.keys(result.lockfile.packages).length).toBe(1)
  })
})
