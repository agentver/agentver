import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
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

describe('storage/lockfile', () => {
  let fs: typeof import('node:fs')
  let lockfileModule: typeof import('../../storage/lockfile')

  beforeEach(async () => {
    vi.clearAllMocks()
    fs = await import('node:fs')
    lockfileModule = await import('../../storage/lockfile')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('readLockfile', () => {
    it('returns empty lockfile when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = lockfileModule.readLockfile('/project')
      expect(result).toEqual({ version: 2, packages: {} })
    })

    it('returns empty lockfile when file contains invalid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('{{invalid')

      const result = lockfileModule.readLockfile('/project')
      expect(result).toEqual({ version: 2, packages: {} })
    })

    it('reads a valid v2 lockfile', () => {
      const validLockfile = {
        version: 2,
        packages: {
          'my-skill': {
            source: {
              type: 'git',
              uri: 'https://github.com/org/repo',
              path: 'skills/my-skill',
              ref: 'main',
              commit: 'abc1234567',
            },
            integrity: 'sha256-abc123',
            agents: ['claude'],
          },
        },
      }

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validLockfile))

      const result = lockfileModule.readLockfile('/project')
      expect(result.version).toBe(2)
      expect(result.packages['my-skill']).toBeDefined()
      expect(result.packages['my-skill']!.integrity).toBe('sha256-abc123')
    })

    it('migrates v1 lockfile to v2', () => {
      const v1Lockfile = {
        version: 1,
        packages: {
          'old-skill': {
            version: '1.0.0',
            resolved: 'https://github.com/org/repo',
            integrity: 'sha256-old',
            agents: ['claude'],
          },
        },
      }

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(v1Lockfile))

      const result = lockfileModule.readLockfile('/project')
      expect(result.version).toBe(2)
      expect(result.packages['old-skill']).toBeDefined()
      expect(result.packages['old-skill']!.source.type).toBe('git')
      expect(fs.writeFileSync).toHaveBeenCalled()
    })

    it('returns empty lockfile when schema validation fails', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: 99 }))

      const result = lockfileModule.readLockfile('/project')
      expect(result).toEqual({ version: 2, packages: {} })
    })
  })

  describe('writeLockfile', () => {
    it('creates directory if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      lockfileModule.writeLockfile('/project', { version: 2, packages: {} })

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.agentver'), {
        recursive: true,
      })
    })

    it('writes atomically via tmp file and rename', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      lockfileModule.writeLockfile('/project', { version: 2, packages: {} })

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        expect.any(String)
      )
      expect(fs.renameSync).toHaveBeenCalled()
    })

    it('throws when lockfile contains invalid source data', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const invalidLockfile = {
        version: 2 as const,
        packages: {
          'bad-skill': {
            source: {
              type: 'git' as const,
              uri: 'https://github.com/org/repo',
              path: '',
              ref: 'main',
              commit: '',
            },
            integrity: 'sha256-abc123',
            agents: ['claude'],
          },
        },
      }

      expect(() => lockfileModule.writeLockfile('/project', invalidLockfile as never)).toThrow()

      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })

    it('writes to tmp file before renaming — crash during write leaves no corrupt lockfile', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      // Simulate a crash during writeFileSync (once only — prevent leaking to next test)
      vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
        throw new Error('ENOSPC: no space left on device')
      })

      expect(() => lockfileModule.writeLockfile('/project', { version: 2, packages: {} })).toThrow(
        'ENOSPC'
      )

      // renameSync should never be called — the original file is untouched
      expect(fs.renameSync).not.toHaveBeenCalled()
    })

    it('rename target is the actual lockfile path, not the tmp path', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      lockfileModule.writeLockfile('/project', { version: 2, packages: {} })

      const renameCall = vi.mocked(fs.renameSync).mock.calls[0]!
      const sourcePath = renameCall[0] as string
      const targetPath = renameCall[1] as string

      expect(sourcePath).toContain('.tmp')
      expect(targetPath).toContain('lockfile.json')
      expect(targetPath).not.toContain('.tmp')
    })
  })

  describe('scope-aware paths', () => {
    it('writes to project .agentver/ when scope is project', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      lockfileModule.writeLockfile('/my-project', { version: 2, packages: {} }, 'project')

      expect(fs.mkdirSync).toHaveBeenCalledWith(join('/my-project', '.agentver'), {
        recursive: true,
      })
    })

    it('writes to ~/.agentver/ when scope is global', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      lockfileModule.writeLockfile('/my-project', { version: 2, packages: {} }, 'global')

      expect(fs.mkdirSync).toHaveBeenCalledWith(join(homedir(), '.agentver'), { recursive: true })
    })

    it('reads from ~/.agentver/ when scope is global', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      lockfileModule.readLockfile('/my-project', 'global')

      expect(fs.existsSync).toHaveBeenCalledWith(join(homedir(), '.agentver', 'lockfile.json'))
    })

    it('defaults to project scope when scope parameter is omitted', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      lockfileModule.readLockfile('/my-project')

      expect(fs.existsSync).toHaveBeenCalledWith(join('/my-project', '.agentver', 'lockfile.json'))
    })
  })
})
