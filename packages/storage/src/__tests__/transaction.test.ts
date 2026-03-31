import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import { STORAGE_SCHEMA_VERSION } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recoverPendingStorageTransaction } from '../index'

let tmpDir: string
let agentverDir: string
let transactionPath: string
let manifestPath: string
let lockfilePath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'agentver-txn-test-'))
  agentverDir = join(tmpDir, '.agentver')
  transactionPath = join(agentverDir, 'storage-transaction.json')
  manifestPath = join(agentverDir, 'manifest.json')
  lockfilePath = join(agentverDir, 'lockfile.json')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function createJournal(data: unknown): void {
  mkdirSync(agentverDir, { recursive: true })
  writeFileSync(transactionPath, JSON.stringify(data, null, 2))
}

function makeValidTransaction(): { manifest: ManifestV2; lockfile: LockfileV2 } {
  return {
    manifest: {
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
    },
    lockfile: {
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
    },
  }
}

describe('recoverPendingStorageTransaction', () => {
  it('is a no-op when no journal exists', () => {
    // Should not throw
    expect(() => recoverPendingStorageTransaction(tmpDir, 'project')).not.toThrow()
    // No files should have been created
    expect(existsSync(manifestPath)).toBe(false)
    expect(existsSync(lockfilePath)).toBe(false)
  })

  it('recovers both files from a valid journal', () => {
    const txn = makeValidTransaction()
    createJournal(txn)

    recoverPendingStorageTransaction(tmpDir, 'project')

    // Manifest and lockfile should be written
    expect(existsSync(manifestPath)).toBe(true)
    expect(existsSync(lockfilePath)).toBe(true)

    const manifestContent = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestV2
    expect(manifestContent.version).toBe(STORAGE_SCHEMA_VERSION)
    expect(Object.keys(manifestContent.packages).length).toBe(1)

    const lockfileContent = JSON.parse(readFileSync(lockfilePath, 'utf-8')) as LockfileV2
    expect(lockfileContent.version).toBe(STORAGE_SCHEMA_VERSION)
    expect(Object.keys(lockfileContent.packages).length).toBe(1)
  })

  it('deletes journal after successful recovery', () => {
    const txn = makeValidTransaction()
    createJournal(txn)

    recoverPendingStorageTransaction(tmpDir, 'project')

    expect(existsSync(transactionPath)).toBe(false)
  })

  it('handles corrupt journal gracefully — invalid JSON', () => {
    mkdirSync(agentverDir, { recursive: true })
    writeFileSync(transactionPath, 'not valid json {{{')

    const warnings: string[] = []
    expect(() =>
      recoverPendingStorageTransaction(tmpDir, 'project', {
        onWarning: (msg) => warnings.push(msg),
      })
    ).not.toThrow()

    // Journal should be cleaned up
    expect(existsSync(transactionPath)).toBe(false)
    // Warning should be emitted
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('handles corrupt journal gracefully — missing manifest field', () => {
    createJournal({ lockfile: makeValidTransaction().lockfile })

    const warnings: string[] = []
    expect(() =>
      recoverPendingStorageTransaction(tmpDir, 'project', {
        onWarning: (msg) => warnings.push(msg),
      })
    ).not.toThrow()

    expect(existsSync(transactionPath)).toBe(false)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('handles corrupt journal gracefully — schema validation fails', () => {
    createJournal({
      manifest: { version: 999, packages: {} },
      lockfile: makeValidTransaction().lockfile,
    })

    const warnings: string[] = []
    expect(() =>
      recoverPendingStorageTransaction(tmpDir, 'project', {
        onWarning: (msg) => warnings.push(msg),
      })
    ).not.toThrow()

    expect(existsSync(transactionPath)).toBe(false)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('emits a warning on successful recovery', () => {
    const txn = makeValidTransaction()
    createJournal(txn)

    const warnings: string[] = []
    recoverPendingStorageTransaction(tmpDir, 'project', {
      onWarning: (msg) => warnings.push(msg),
    })

    expect(warnings.some((w) => w.includes('Recovered'))).toBe(true)
  })
})
