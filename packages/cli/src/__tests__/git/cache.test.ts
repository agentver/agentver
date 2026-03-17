import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitSource } from '../../git/types'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}))

vi.mock('@agentver/shared', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const mockSource: GitSource = {
  host: 'github.com',
  owner: 'test-owner',
  repo: 'test-repo',
  path: '',
  ref: 'main',
}

describe('git/cache', () => {
  let fs: typeof import('node:fs')
  let cacheModule: typeof import('../../git/cache')

  beforeEach(async () => {
    vi.clearAllMocks()
    fs = await import('node:fs')
    cacheModule = await import('../../git/cache')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getCacheDir', () => {
    it('returns the cache directory path under home', () => {
      expect(cacheModule.getCacheDir()).toBe('/home/testuser/.agentver/cache')
    })
  })

  describe('getRepoCacheDir', () => {
    it('returns the repo-specific cache directory', () => {
      const result = cacheModule.getRepoCacheDir(mockSource)
      expect(result).toBe('/home/testuser/.agentver/cache/github.com/test-owner/test-repo')
    })
  })

  describe('getCachedFiles', () => {
    it('returns null when commit directory does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = cacheModule.getCachedFiles(mockSource, 'some-sha')
      expect(result).toBeNull()
    })

    it('returns null when directory is empty', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readdirSync).mockReturnValue([])

      const result = cacheModule.getCachedFiles(mockSource, 'some-sha')
      expect(result).toBeNull()
    })
  })

  describe('cacheFiles', () => {
    it('writes files to the commit cache directory', () => {
      cacheModule.cacheFiles(mockSource, 'sha-123', [
        { path: 'index.md', content: '# Hello', size: 7 },
      ])

      expect(fs.mkdirSync).toHaveBeenCalled()
      expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('index.md'), '# Hello')
    })
  })
})
