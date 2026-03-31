import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLockfile, createManifest } from '../helpers/fixtures'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
}))

vi.mock('../../storage/files', () => ({
  ensureStorageDir: vi.fn(),
  getLockfilePath: vi.fn((projectRoot: string) => join(projectRoot, '.agentver', 'lockfile.json')),
  getManifestPath: vi.fn((projectRoot: string) => join(projectRoot, '.agentver', 'manifest.json')),
  getStorageTransactionPath: vi.fn((projectRoot: string) =>
    join(projectRoot, '.agentver', 'storage-transaction.json')
  ),
  writeJsonFileAtomic: vi.fn(),
}))

vi.mock('@agentver/shared', async () => {
  const actual = await vi.importActual<typeof import('@agentver/shared')>('@agentver/shared')
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }
})

import * as fs from 'node:fs'
import * as filesModule from '../../storage/files'
import * as transactionModule from '../../storage/transaction'

describe('storage/transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replays a pending transaction onto manifest and lockfile', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        manifest: createManifest({
          packages: {
            'test-skill': {
              source: {
                type: 'git',
                uri: 'github.com/test-org/test-repo',
                path: 'skills/test-skill',
                ref: 'main',
                commit: 'abc1234567890abcdef1234567890abcdef123456',
              },
              agents: ['claude-code'],
              installedAt: '2026-03-31T12:00:00.000Z',
              modified: false,
            },
          },
        }),
        lockfile: createLockfile({
          packages: {
            'test-skill': {
              source: {
                type: 'git',
                uri: 'github.com/test-org/test-repo',
                path: 'skills/test-skill',
                ref: 'main',
                commit: 'abc1234567890abcdef1234567890abcdef123456',
              },
              integrity: 'sha256-test',
              agents: ['claude-code'],
            },
          },
        }),
      })
    )

    transactionModule.recoverPendingStorageTransaction('/project')

    expect(filesModule.writeJsonFileAtomic).toHaveBeenCalledTimes(2)
    expect(filesModule.writeJsonFileAtomic).toHaveBeenNthCalledWith(
      1,
      join('/project', '.agentver', 'manifest.json'),
      expect.objectContaining({
        packages: expect.objectContaining({
          'test-skill': expect.any(Object),
        }),
      })
    )
    expect(filesModule.writeJsonFileAtomic).toHaveBeenNthCalledWith(
      2,
      join('/project', '.agentver', 'lockfile.json'),
      expect.objectContaining({
        packages: expect.objectContaining({
          'test-skill': expect.any(Object),
        }),
      })
    )
    expect(fs.rmSync).toHaveBeenCalledWith(
      join('/project', '.agentver', 'storage-transaction.json'),
      { force: true }
    )
  })

  it('leaves a recoverable transaction when lockfile persistence fails mid-write', () => {
    const manifest = createManifest({
      packages: {
        'test-skill': {
          source: {
            type: 'git',
            uri: 'github.com/test-org/test-repo',
            path: 'skills/test-skill',
            ref: 'main',
            commit: 'abc1234567890abcdef1234567890abcdef123456',
          },
          agents: ['claude-code'],
          installedAt: '2026-03-31T12:00:00.000Z',
          modified: false,
        },
      },
    })
    const lockfile = createLockfile({
      packages: {
        'test-skill': {
          source: manifest.packages['test-skill']!.source,
          integrity: 'sha256-test',
          agents: ['claude-code'],
        },
      },
    })

    vi.mocked(filesModule.writeJsonFileAtomic)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('ENOSPC: no space left on device')
      })

    expect(() => transactionModule.writeStorageTransaction('/project', manifest, lockfile)).toThrow(
      'ENOSPC'
    )

    expect(filesModule.writeJsonFileAtomic).toHaveBeenNthCalledWith(
      1,
      join('/project', '.agentver', 'storage-transaction.json'),
      { manifest, lockfile }
    )
    expect(filesModule.writeJsonFileAtomic).toHaveBeenNthCalledWith(
      2,
      join('/project', '.agentver', 'manifest.json'),
      manifest
    )
    expect(filesModule.writeJsonFileAtomic).toHaveBeenNthCalledWith(
      3,
      join('/project', '.agentver', 'lockfile.json'),
      lockfile
    )
    expect(fs.rmSync).not.toHaveBeenCalled()

    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ manifest, lockfile }))
    vi.mocked(filesModule.writeJsonFileAtomic).mockReset()

    transactionModule.recoverPendingStorageTransaction('/project')

    expect(filesModule.writeJsonFileAtomic).toHaveBeenNthCalledWith(
      1,
      join('/project', '.agentver', 'manifest.json'),
      manifest
    )
    expect(filesModule.writeJsonFileAtomic).toHaveBeenNthCalledWith(
      2,
      join('/project', '.agentver', 'lockfile.json'),
      lockfile
    )
    expect(fs.rmSync).toHaveBeenCalledWith(
      join('/project', '.agentver', 'storage-transaction.json'),
      { force: true }
    )
  })

  it('leaves a recoverable transaction when manifest persistence fails mid-write', () => {
    const manifest = createManifest({
      packages: {
        'test-skill': {
          source: {
            type: 'git',
            uri: 'github.com/test-org/test-repo',
            path: 'skills/test-skill',
            ref: 'main',
            commit: 'abc1234567890abcdef1234567890abcdef123456',
          },
          agents: ['claude-code'],
          installedAt: '2026-03-31T12:00:00.000Z',
          modified: false,
        },
      },
    })
    const lockfile = createLockfile({
      packages: {
        'test-skill': {
          source: manifest.packages['test-skill']!.source,
          integrity: 'sha256-test',
          agents: ['claude-code'],
        },
      },
    })

    vi.mocked(filesModule.writeJsonFileAtomic)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('ENOSPC: manifest write failed')
      })

    expect(() => transactionModule.writeStorageTransaction('/project', manifest, lockfile)).toThrow(
      'manifest write failed'
    )

    expect(filesModule.writeJsonFileAtomic).toHaveBeenNthCalledWith(
      1,
      join('/project', '.agentver', 'storage-transaction.json'),
      { manifest, lockfile }
    )
    expect(filesModule.writeJsonFileAtomic).toHaveBeenNthCalledWith(
      2,
      join('/project', '.agentver', 'manifest.json'),
      manifest
    )
    expect(fs.rmSync).not.toHaveBeenCalled()

    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ manifest, lockfile }))
    vi.mocked(filesModule.writeJsonFileAtomic).mockReset()

    transactionModule.recoverPendingStorageTransaction('/project')

    expect(filesModule.writeJsonFileAtomic).toHaveBeenNthCalledWith(
      1,
      join('/project', '.agentver', 'manifest.json'),
      manifest
    )
    expect(filesModule.writeJsonFileAtomic).toHaveBeenNthCalledWith(
      2,
      join('/project', '.agentver', 'lockfile.json'),
      lockfile
    )
    expect(fs.rmSync).toHaveBeenCalledWith(
      join('/project', '.agentver', 'storage-transaction.json'),
      { force: true }
    )
  })

  it('deletes a transaction when required keys are missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('{}')

    transactionModule.recoverPendingStorageTransaction('/project')

    expect(filesModule.writeJsonFileAtomic).not.toHaveBeenCalled()
    expect(fs.rmSync).toHaveBeenCalledWith(
      join('/project', '.agentver', 'storage-transaction.json'),
      { force: true }
    )
  })

  it('deletes a transaction when the WAL contains invalid JSON', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('not-json')

    transactionModule.recoverPendingStorageTransaction('/project')

    expect(filesModule.writeJsonFileAtomic).not.toHaveBeenCalled()
    expect(fs.rmSync).toHaveBeenCalledWith(
      join('/project', '.agentver', 'storage-transaction.json'),
      { force: true }
    )
  })
})
