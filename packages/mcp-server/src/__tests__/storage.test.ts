import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLockfile, createManifest } from './helpers/fixtures'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

describe('storage', () => {
  let fs: typeof import('node:fs')
  let storage: typeof import('../storage')

  beforeEach(async () => {
    vi.clearAllMocks()
    fs = await import('node:fs')
    storage = await import('../storage')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('readManifest', () => {
    it('returns default manifest when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = storage.readManifest('/project')
      expect(result).toEqual({ version: 1, packages: {} })
    })

    it('returns default manifest when file contains invalid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('not-json')

      const result = storage.readManifest('/project')
      expect(result).toEqual({ version: 1, packages: {} })
    })

    it('reads and returns valid manifest JSON', () => {
      const manifest = createManifest({
        packages: {
          'test-org/test-skill': {
            name: 'test-org/test-skill',
            version: '1.0.0',
            agents: ['claude-code'],
            installedAt: '2024-01-01T00:00:00.000Z',
          },
        },
      })

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest))

      const result = storage.readManifest('/project')
      expect(result).toEqual(manifest)
    })

    it('constructs correct path', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      storage.readManifest('/my/project')
      expect(fs.existsSync).toHaveBeenCalledWith(join('/my/project', '.agentver', 'manifest.json'))
    })
  })

  describe('writeManifest', () => {
    it('creates .agentver directory when it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      storage.writeManifest('/project', createManifest())
      expect(fs.mkdirSync).toHaveBeenCalledWith(join('/project', '.agentver'), { recursive: true })
    })

    it('does not create directory when it already exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      storage.writeManifest('/project', createManifest())
      expect(fs.mkdirSync).not.toHaveBeenCalled()
    })

    it('writes formatted JSON to correct path', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const manifest = createManifest()
      storage.writeManifest('/project', manifest)

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        join('/project', '.agentver', 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      )
    })
  })

  describe('readLockfile', () => {
    it('returns default lockfile when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = storage.readLockfile('/project')
      expect(result).toEqual({ version: 1, packages: {} })
    })

    it('returns default lockfile when file contains invalid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('not-json')

      const result = storage.readLockfile('/project')
      expect(result).toEqual({ version: 1, packages: {} })
    })

    it('reads and returns valid lockfile JSON', () => {
      const lockfile = createLockfile({
        packages: {
          'test-org/test-skill': {
            version: '1.0.0',
            resolved: 'https://app.agentver.com/api/v1/skills/test-org/test-skill/1.0.0/download',
            integrity: 'sha256-abc123',
            agents: ['claude-code'],
          },
        },
      })

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(lockfile))

      const result = storage.readLockfile('/project')
      expect(result).toEqual(lockfile)
    })
  })

  describe('writeLockfile', () => {
    it('creates directory when missing', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      storage.writeLockfile('/project', createLockfile())
      expect(fs.mkdirSync).toHaveBeenCalledWith(join('/project', '.agentver'), { recursive: true })
    })

    it('writes formatted JSON to correct path', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const lockfile = createLockfile()
      storage.writeLockfile('/project', lockfile)

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        join('/project', '.agentver', 'lockfile.json'),
        JSON.stringify(lockfile, null, 2)
      )
    })
  })
})
