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
  })
})
