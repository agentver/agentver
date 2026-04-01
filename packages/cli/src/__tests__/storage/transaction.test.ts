import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLockfile, createManifest } from '../helpers/fixtures'

const mockRecoverFromStorage = vi.fn()
const mockWriteFromStorage = vi.fn()

vi.mock('@agentver/storage', () => ({
  recoverPendingStorageTransaction: (...args: unknown[]) => mockRecoverFromStorage(...args),
  writeStorageTransaction: (...args: unknown[]) => mockWriteFromStorage(...args),
}))

vi.mock('../../utils.js', () => ({
  createCliLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import * as transactionModule from '../../storage/transaction'

describe('storage/transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates recoverPendingStorageTransaction to storage package with CLI callbacks', () => {
    transactionModule.recoverPendingStorageTransaction('/project')

    expect(mockRecoverFromStorage).toHaveBeenCalledWith(
      '/project',
      'project',
      expect.objectContaining({
        onWarning: expect.any(Function),
      })
    )
  })

  it('delegates recoverPendingStorageTransaction with custom scope', () => {
    transactionModule.recoverPendingStorageTransaction('/project', 'global')

    expect(mockRecoverFromStorage).toHaveBeenCalledWith(
      '/project',
      'global',
      expect.objectContaining({
        onWarning: expect.any(Function),
      })
    )
  })

  it('delegates writeStorageTransaction to storage package', () => {
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

    transactionModule.writeStorageTransaction('/project', manifest, lockfile)

    expect(mockWriteFromStorage).toHaveBeenCalledWith('/project', manifest, lockfile, 'project')
  })

  it('delegates writeStorageTransaction with custom scope', () => {
    const manifest = createManifest()
    const lockfile = createLockfile()

    transactionModule.writeStorageTransaction('/project', manifest, lockfile, 'global')

    expect(mockWriteFromStorage).toHaveBeenCalledWith('/project', manifest, lockfile, 'global')
  })

  it('propagates errors from storage writeStorageTransaction', () => {
    const manifest = createManifest()
    const lockfile = createLockfile()

    mockWriteFromStorage.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device')
    })

    expect(() => transactionModule.writeStorageTransaction('/project', manifest, lockfile)).toThrow(
      'ENOSPC'
    )
  })
})
