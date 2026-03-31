import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLockfile, createManifest } from '../helpers/fixtures'

vi.mock('../../storage/file-lock', () => ({
  withStorageLock: <T>(_projectRoot: string, _scope: string, callback: () => T) => callback(),
}))

vi.mock('../../storage/manifest', () => ({
  readManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile', () => ({
  readLockfile: vi.fn(),
}))

vi.mock('../../storage/transaction', () => ({
  recoverPendingStorageTransaction: vi.fn(),
  writeStorageTransaction: vi.fn(),
}))

import * as lockfileModule from '../../storage/lockfile'
import * as manifestModule from '../../storage/manifest'
import * as pairModule from '../../storage/pair'
import * as transactionModule from '../../storage/transaction'

describe('storage/pair', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
    vi.mocked(lockfileModule.readLockfile).mockReturnValue(createLockfile())
  })

  it('reads both files and writes them back through the storage transaction', () => {
    const result = pairModule.updateManifestAndLockfile(
      '/project',
      'project',
      (manifest, lockfile) => {
        manifest.packages['test-skill'] = {
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
        }
        lockfile.packages['test-skill'] = {
          source: manifest.packages['test-skill']!.source,
          integrity: 'sha256-test',
          agents: ['claude-code'],
        }
        return { manifest, lockfile }
      }
    )

    expect(transactionModule.recoverPendingStorageTransaction).toHaveBeenCalledWith(
      '/project',
      'project'
    )
    expect(manifestModule.readManifest).toHaveBeenCalledWith('/project', 'project')
    expect(lockfileModule.readLockfile).toHaveBeenCalledWith('/project', 'project')
    expect(transactionModule.writeStorageTransaction).toHaveBeenCalledWith(
      '/project',
      result.manifest,
      result.lockfile,
      'project'
    )
  })
})
