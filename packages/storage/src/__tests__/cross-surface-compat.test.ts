import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LockfileV2, LockfileV2Package, ManifestV2, ManifestV2Package } from '@agentver/shared'
import { STORAGE_SCHEMA_VERSION } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acquireLock,
  computeIntegrity,
  getStorageTransactionPath,
  IntegrityError,
  readLockfile,
  readManifest,
  StorageCorruptionError,
  updateManifestAndLockfile,
  verifyIntegrity,
  withStorageLock,
  writeLockfile,
  writeManifest,
} from '../index'

let tmpDir: string
let agentverDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'agentver-cross-surface-'))
  agentverDir = join(tmpDir, '.agentver')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const NO_LOCK = { mode: 'none' as const }

function makeGitManifestPkg(name: string): ManifestV2Package {
  return {
    name,
    source: {
      type: 'git',
      uri: 'https://github.com/org/repo.git',
      path: `skills/${name}`,
      ref: 'main',
      commit: 'abc1234',
    },
    agents: ['claude-code', 'cursor'],
    installedAt: '2025-06-15T10:00:00.000Z',
    modified: false,
    packageType: 'SKILL',
    entryFile: 'SKILL.md',
    dependsOn: ['dep-a'],
    conflictsWith: ['conflict-b'],
    pinned: true,
  }
}

function makePlatformManifestPkg(name: string): ManifestV2Package {
  return {
    name,
    source: {
      type: 'platform',
      uri: 'agentver://skills',
      path: `skills/${name}`,
      ref: 'v1.0.0',
      commit: 'def5678',
    },
    agents: ['copilot'],
    installedAt: '2025-06-16T12:00:00.000Z',
    modified: true,
    packageType: 'AGENT_CONFIG',
    entryFile: 'CLAUDE.md',
  }
}

function makeLocalManifestPkg(name: string): ManifestV2Package {
  return {
    name,
    source: {
      type: 'local',
      path: `/home/user/skills/${name}`,
    },
    agents: [],
    installedAt: '2025-06-17T08:30:00.000Z',
    modified: false,
    packageType: 'SCRIPT',
    entryFile: 'script.json',
    dependsOn: [],
    conflictsWith: [],
  }
}

function makeGitLockfilePkg(name: string): LockfileV2Package {
  return {
    name,
    source: {
      type: 'git',
      uri: 'https://github.com/org/repo.git',
      path: `skills/${name}`,
      ref: 'main',
      commit: 'abc1234',
    },
    integrity: 'sha256-dGVzdGluZw==',
    agents: ['claude-code', 'cursor'],
    linkMode: 'symlink',
    degraded: false,
  }
}

function makePlatformLockfilePkg(name: string): LockfileV2Package {
  return {
    name,
    source: {
      type: 'platform',
      uri: 'agentver://skills',
      path: `skills/${name}`,
      ref: 'v1.0.0',
      commit: 'def5678',
    },
    integrity: 'sha256-cGxhdGZvcm0=',
    agents: ['copilot'],
    linkMode: 'copy',
    degraded: true,
  }
}

function makeLocalLockfilePkg(name: string): LockfileV2Package {
  return {
    name,
    source: {
      type: 'local',
      path: `/home/user/skills/${name}`,
    },
    integrity: 'sha256-bG9jYWw=',
    agents: [],
  }
}

// --- Cross-surface manifest compatibility ---

describe('cross-surface manifest compatibility', () => {
  it('write then read roundtrip preserves all fields', () => {
    const gitKey = 'git:git-skill'
    const platformKey = 'platform:platform-skill'
    const localKey = 'local:local-skill'

    const manifest: ManifestV2 = {
      version: STORAGE_SCHEMA_VERSION,
      packages: {
        [gitKey]: makeGitManifestPkg('git-skill'),
        [platformKey]: makePlatformManifestPkg('platform-skill'),
        [localKey]: makeLocalManifestPkg('local-skill'),
      },
    }

    writeManifest(tmpDir, manifest, 'project', NO_LOCK)
    const { data: read } = readManifest(tmpDir, 'project')

    expect(read.version).toBe(STORAGE_SCHEMA_VERSION)
    expect(Object.keys(read.packages).length).toBe(3)

    const gitPkg = read.packages[gitKey]!
    expect(gitPkg.name).toBe('git-skill')
    expect(gitPkg.source).toEqual(manifest.packages[gitKey]!.source)
    expect(gitPkg.agents).toEqual(['claude-code', 'cursor'])
    expect(gitPkg.installedAt).toBe('2025-06-15T10:00:00.000Z')
    expect(gitPkg.modified).toBe(false)
    expect(gitPkg.packageType).toBe('SKILL')
    expect(gitPkg.entryFile).toBe('SKILL.md')
    expect(gitPkg.dependsOn).toEqual(['dep-a'])
    expect(gitPkg.conflictsWith).toEqual(['conflict-b'])
    expect(gitPkg.pinned).toBe(true)

    const platformPkg = read.packages[platformKey]!
    expect(platformPkg.name).toBe('platform-skill')
    expect(platformPkg.source.type).toBe('platform')
    expect(platformPkg.modified).toBe(true)
    expect(platformPkg.packageType).toBe('AGENT_CONFIG')

    const localPkg = read.packages[localKey]!
    expect(localPkg.name).toBe('local-skill')
    expect(localPkg.source.type).toBe('local')
    expect(localPkg.packageType).toBe('SCRIPT')
  })

  it('write then read roundtrip preserves all lockfile fields', () => {
    const gitKey = 'git:lf-git'
    const platformKey = 'platform:lf-platform'
    const localKey = 'local:lf-local'

    const lockfile: LockfileV2 = {
      version: STORAGE_SCHEMA_VERSION,
      packages: {
        [gitKey]: makeGitLockfilePkg('lf-git'),
        [platformKey]: makePlatformLockfilePkg('lf-platform'),
        [localKey]: makeLocalLockfilePkg('lf-local'),
      },
    }

    writeLockfile(tmpDir, lockfile, 'project', NO_LOCK)
    const { data: read } = readLockfile(tmpDir, 'project')

    expect(read.version).toBe(STORAGE_SCHEMA_VERSION)
    expect(Object.keys(read.packages).length).toBe(3)

    const gitPkg = read.packages[gitKey]!
    expect(gitPkg.name).toBe('lf-git')
    expect(gitPkg.source).toEqual(lockfile.packages[gitKey]!.source)
    expect(gitPkg.integrity).toBe('sha256-dGVzdGluZw==')
    expect(gitPkg.agents).toEqual(['claude-code', 'cursor'])
    expect(gitPkg.linkMode).toBe('symlink')
    expect(gitPkg.degraded).toBe(false)

    const platformPkg = read.packages[platformKey]!
    expect(platformPkg.integrity).toBe('sha256-cGxhdGZvcm0=')
    expect(platformPkg.linkMode).toBe('copy')
    expect(platformPkg.degraded).toBe(true)

    const localPkg = read.packages[localKey]!
    expect(localPkg.integrity).toBe('sha256-bG9jYWw=')
    expect(localPkg.linkMode).toBeUndefined()
    expect(localPkg.degraded).toBeUndefined()
  })

  it('paired write atomically updates both files', () => {
    const result = updateManifestAndLockfile(
      tmpDir,
      'project',
      (manifest, lockfile) => ({
        manifest: {
          ...manifest,
          packages: {
            'git:paired': {
              name: 'paired-skill',
              source: {
                type: 'git' as const,
                uri: 'https://github.com/org/repo.git',
                path: 'skills/paired',
                ref: 'main',
                commit: 'abc1234',
              },
              agents: ['claude-code'],
              installedAt: '2025-06-01T00:00:00.000Z',
              modified: false,
            },
          },
        },
        lockfile: {
          ...lockfile,
          packages: {
            'git:paired': {
              name: 'paired-skill',
              source: {
                type: 'git' as const,
                uri: 'https://github.com/org/repo.git',
                path: 'skills/paired',
                ref: 'main',
                commit: 'abc1234',
              },
              integrity: 'sha256-cGFpcmVk',
              agents: ['claude-code'],
            },
          },
        },
      }),
      NO_LOCK
    )

    expect(result.manifest.packages['git:paired']?.name).toBe('paired-skill')
    expect(result.lockfile.packages['git:paired']?.integrity).toBe('sha256-cGFpcmVk')

    const { data: manifestOnDisc } = readManifest(tmpDir, 'project')
    const { data: lockfileOnDisc } = readLockfile(tmpDir, 'project')

    expect(manifestOnDisc.packages['git:paired']?.name).toBe('paired-skill')
    expect(manifestOnDisc.version).toBe(STORAGE_SCHEMA_VERSION)
    expect(lockfileOnDisc.packages['git:paired']?.integrity).toBe('sha256-cGFpcmVk')
    expect(lockfileOnDisc.version).toBe(STORAGE_SCHEMA_VERSION)
  })

  it('serialisation is byte-identical for the same data', () => {
    const manifest: ManifestV2 = {
      version: STORAGE_SCHEMA_VERSION,
      packages: {
        'git:byte-test': makeGitManifestPkg('byte-test'),
      },
    }

    writeManifest(tmpDir, manifest, 'project', NO_LOCK)
    const firstWrite = readFileSync(join(agentverDir, 'manifest.json'), 'utf-8')

    const { data: readBack } = readManifest(tmpDir, 'project')
    writeManifest(tmpDir, readBack, 'project', NO_LOCK)
    const secondWrite = readFileSync(join(agentverDir, 'manifest.json'), 'utf-8')

    expect(secondWrite).toBe(firstWrite)
  })

  it('key ordering is deterministic regardless of insertion order', () => {
    const manifest: ManifestV2 = {
      version: STORAGE_SCHEMA_VERSION,
      packages: {
        'local:z-skill': makeLocalManifestPkg('z-skill'),
        'local:a-skill': makeLocalManifestPkg('a-skill'),
        'local:m-skill': makeLocalManifestPkg('m-skill'),
      },
    }

    writeManifest(tmpDir, manifest, 'project', NO_LOCK)
    const raw = readFileSync(join(agentverDir, 'manifest.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    const packageKeys = Object.keys(parsed.packages)

    expect(packageKeys).toEqual(['local:a-skill', 'local:m-skill', 'local:z-skill'])
  })
})

// --- Transaction recovery ---

describe('transaction recovery', () => {
  it('paired write creates and removes transaction journal', () => {
    const transactionPath = getStorageTransactionPath(tmpDir, 'project')

    expect(existsSync(transactionPath)).toBe(false)

    updateManifestAndLockfile(
      tmpDir,
      'project',
      (manifest, lockfile) => ({
        manifest: {
          ...manifest,
          packages: {
            'local:txn-test': {
              name: 'txn-test',
              source: { type: 'local' as const, path: '/tmp/txn' },
              agents: [],
              installedAt: '2025-01-01T00:00:00.000Z',
              modified: false,
            },
          },
        },
        lockfile: {
          ...lockfile,
          packages: {
            'local:txn-test': {
              name: 'txn-test',
              source: { type: 'local' as const, path: '/tmp/txn' },
              integrity: 'sha256-dHhu',
              agents: [],
            },
          },
        },
      }),
      NO_LOCK
    )

    expect(existsSync(transactionPath)).toBe(false)

    const { data: manifestResult } = readManifest(tmpDir, 'project')
    const { data: lockfileResult } = readLockfile(tmpDir, 'project')
    expect(manifestResult.packages['local:txn-test']?.name).toBe('txn-test')
    expect(lockfileResult.packages['local:txn-test']?.integrity).toBe('sha256-dHhu')
  })

  it('recovery replays transaction journal on next read', () => {
    const transactionPath = getStorageTransactionPath(tmpDir, 'project')

    const journalManifest: ManifestV2 = {
      version: STORAGE_SCHEMA_VERSION,
      packages: {
        'git:recovered': {
          name: 'recovered-skill',
          source: {
            type: 'git',
            uri: 'https://github.com/org/repo.git',
            path: 'skills/recovered',
            ref: 'main',
            commit: 'abc1234',
          },
          agents: ['claude-code'],
          installedAt: '2025-01-01T00:00:00.000Z',
          modified: false,
        },
      },
    }

    const journalLockfile: LockfileV2 = {
      version: STORAGE_SCHEMA_VERSION,
      packages: {
        'git:recovered': {
          name: 'recovered-skill',
          source: {
            type: 'git',
            uri: 'https://github.com/org/repo.git',
            path: 'skills/recovered',
            ref: 'main',
            commit: 'abc1234',
          },
          integrity: 'sha256-cmVjb3ZlcmVk',
          agents: ['claude-code'],
        },
      },
    }

    mkdirSync(agentverDir, { recursive: true })
    writeFileSync(
      transactionPath,
      JSON.stringify({ manifest: journalManifest, lockfile: journalLockfile }, null, 2)
    )

    updateManifestAndLockfile(
      tmpDir,
      'project',
      (manifest, lockfile) => ({ manifest, lockfile }),
      NO_LOCK
    )

    const { data: manifestResult } = readManifest(tmpDir, 'project')
    expect(manifestResult.packages['git:recovered']?.name).toBe('recovered-skill')

    const { data: lockfileResult } = readLockfile(tmpDir, 'project')
    expect(lockfileResult.packages['git:recovered']?.integrity).toBe('sha256-cmVjb3ZlcmVk')

    expect(existsSync(transactionPath)).toBe(false)
  })

  it('corrupt transaction journal is safely removed', () => {
    const transactionPath = getStorageTransactionPath(tmpDir, 'project')

    mkdirSync(agentverDir, { recursive: true })
    writeFileSync(transactionPath, '{{{{not valid json at all!!')

    const warnings: string[] = []
    expect(() =>
      updateManifestAndLockfile(
        tmpDir,
        'project',
        (manifest, lockfile) => ({
          manifest: {
            ...manifest,
            packages: {
              'local:after-corrupt': {
                name: 'after-corrupt',
                source: { type: 'local' as const, path: '/tmp/ok' },
                agents: [],
                installedAt: '2025-01-01T00:00:00.000Z',
                modified: false,
              },
            },
          },
          lockfile: {
            ...lockfile,
            packages: {
              'local:after-corrupt': {
                name: 'after-corrupt',
                source: { type: 'local' as const, path: '/tmp/ok' },
                integrity: 'sha256-b2s=',
                agents: [],
              },
            },
          },
        }),
        NO_LOCK,
        { onWarning: (msg) => warnings.push(msg) }
      )
    ).not.toThrow()

    expect(existsSync(transactionPath)).toBe(false)

    const { data: result } = readManifest(tmpDir, 'project')
    expect(result.packages['local:after-corrupt']?.name).toBe('after-corrupt')
  })
})

// --- Integrity computation ---

describe('integrity computation', () => {
  it('computeIntegrity is deterministic for same file content', () => {
    const files = [
      { path: 'a.md', content: 'hello' },
      { path: 'b.md', content: 'world' },
    ]
    const hash1 = computeIntegrity(files)
    const hash2 = computeIntegrity(files)
    expect(hash1).toBe(hash2)
  })

  it('computeIntegrity is order-independent', () => {
    const filesForward = [
      { path: 'a.md', content: 'hello' },
      { path: 'b.md', content: 'world' },
    ]
    const filesReversed = [
      { path: 'b.md', content: 'world' },
      { path: 'a.md', content: 'hello' },
    ]
    expect(computeIntegrity(filesForward)).toBe(computeIntegrity(filesReversed))
  })

  it('verifyIntegrity throws IntegrityError on mismatch', () => {
    const files = [
      { path: 'a.md', content: 'hello' },
      { path: 'b.md', content: 'world' },
    ]
    const actual = computeIntegrity(files)

    try {
      verifyIntegrity(files, 'sha256-WRONGHASH', 'my-skill')
      expect.fail('Expected IntegrityError to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrityError)
      const integrityError = error as IntegrityError
      expect(integrityError.packageName).toBe('my-skill')
      expect(integrityError.expected).toBe('sha256-WRONGHASH')
      expect(integrityError.actual).toBe(actual)
    }
  })

  it('computeIntegrity changes when file content changes', () => {
    const filesA = [
      { path: 'a.md', content: 'version-one' },
      { path: 'b.md', content: 'shared' },
    ]
    const filesB = [
      { path: 'a.md', content: 'version-two' },
      { path: 'b.md', content: 'shared' },
    ]
    expect(computeIntegrity(filesA)).not.toBe(computeIntegrity(filesB))
  })
})

// --- File locking ---

describe('file locking', () => {
  it('withStorageLock executes callback and releases lock', () => {
    let callbackExecuted = false
    const lockPath = join(agentverDir, '.lock')

    withStorageLock(tmpDir, 'project', () => {
      callbackExecuted = true
    })

    expect(callbackExecuted).toBe(true)
    expect(existsSync(lockPath)).toBe(false)
  })

  it('advisory lock mode proceeds without blocking', () => {
    const release1 = acquireLock(tmpDir, 'project', { mode: 'advisory' })
    try {
      const release2 = acquireLock(tmpDir, 'project', { mode: 'advisory' })
      release2()
    } finally {
      release1()
    }
  })

  it('StorageCorruptionError has correct properties', () => {
    const manifestPath = join(agentverDir, 'manifest.json')
    mkdirSync(agentverDir, { recursive: true })
    writeFileSync(manifestPath, '{invalid json content here!!!}}}')

    try {
      readManifest(tmpDir, 'project')
      expect.fail('Expected StorageCorruptionError to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(StorageCorruptionError)
      const corruptionError = error as StorageCorruptionError
      expect(corruptionError.filePath).toBe(manifestPath)
      expect(corruptionError.reason).toBe('invalid-json')
    }
  })
})
