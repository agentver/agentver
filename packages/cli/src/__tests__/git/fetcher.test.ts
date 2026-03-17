import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitSource, ResolvedRef } from '../../git/types'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('node:os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
}))

vi.mock('../../git/cache.js', () => ({
  getCachedFiles: vi.fn(),
  cacheFiles: vi.fn(),
}))

vi.mock('@agentver/shared', () => ({
  AgentverError: class AgentverError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
      this.name = 'AgentverError'
    }
  },
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('git/fetcher', () => {
  let fetcherModule: typeof import('../../git/fetcher')
  let cacheModule: typeof import('../../git/cache')

  beforeEach(async () => {
    vi.clearAllMocks()
    fetcherModule = await import('../../git/fetcher')
    cacheModule = await import('../../git/cache')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('buildRepoUrl', () => {
    it('builds the correct HTTPS clone URL', () => {
      const source: GitSource = {
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        path: '',
        ref: 'HEAD',
      }
      expect(fetcherModule.buildRepoUrl(source)).toBe('https://github.com/owner/repo.git')
    })

    it('works for GitLab sources', () => {
      const source: GitSource = {
        host: 'gitlab.com',
        owner: 'group',
        repo: 'project',
        path: '',
        ref: 'HEAD',
      }
      expect(fetcherModule.buildRepoUrl(source)).toBe('https://gitlab.com/group/project.git')
    })

    it('works for generic hosts', () => {
      const source: GitSource = {
        host: 'generic',
        owner: 'org',
        repo: 'repo',
        path: '',
        ref: 'HEAD',
      }
      expect(fetcherModule.buildRepoUrl(source)).toBe('https://generic/org/repo.git')
    })
  })

  describe('readFilesFromDirectory', () => {
    it('skips files exceeding 5MB', async () => {
      const fsp = await import('node:fs/promises')

      vi.mocked(fsp.readdir).mockResolvedValue([
        { name: 'huge.bin', isDirectory: () => false, isFile: () => true },
      ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)

      vi.mocked(fsp.stat).mockResolvedValue({
        size: 6 * 1024 * 1024, // 6MB — exceeds MAX_FILE_SIZE_BYTES (5MB)
      } as Awaited<ReturnType<typeof fsp.stat>>)

      const result = await fetcherModule.readFilesFromDirectory('/some/dir')
      expect(result).toHaveLength(0)
    })

    it('includes files under the 5MB limit', async () => {
      const fsp = await import('node:fs/promises')

      vi.mocked(fsp.readdir).mockResolvedValue([
        { name: 'small.md', isDirectory: () => false, isFile: () => true },
      ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)

      vi.mocked(fsp.stat).mockResolvedValue({
        size: 100,
      } as Awaited<ReturnType<typeof fsp.stat>>)

      vi.mocked(fsp.readFile).mockResolvedValue('# Hello')

      const result = await fetcherModule.readFilesFromDirectory('/some/dir')
      expect(result).toHaveLength(1)
      expect(result[0]!.path).toBe('small.md')
    })

    it('skips .git directories', async () => {
      const fsp = await import('node:fs/promises')

      vi.mocked(fsp.readdir).mockResolvedValue([
        { name: '.git', isDirectory: () => true, isFile: () => false },
        { name: 'readme.md', isDirectory: () => false, isFile: () => true },
      ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)

      vi.mocked(fsp.stat).mockResolvedValue({ size: 10 } as Awaited<ReturnType<typeof fsp.stat>>)
      vi.mocked(fsp.readFile).mockResolvedValue('# Readme')

      const result = await fetcherModule.readFilesFromDirectory('/repo')
      expect(result).toHaveLength(1)
      expect(result[0]!.path).toBe('readme.md')
    })
  })

  describe('fetchFiles', () => {
    it('returns cached files when available', async () => {
      const source: GitSource = {
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        path: '',
        ref: 'main',
      }

      const resolved: ResolvedRef = { source, commitSha: 'sha-123' }
      const cachedFiles = [{ path: 'index.md', content: '# test', size: 6 }]

      vi.mocked(cacheModule.getCachedFiles).mockReturnValue(cachedFiles)

      const result = await fetcherModule.fetchFiles(resolved)
      expect(result.files).toEqual(cachedFiles)
      expect(result.commitSha).toBe('sha-123')
    })

    it('caches files after a successful strategy', async () => {
      const source: GitSource = {
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        path: '',
        ref: 'main',
      }
      const resolved: ResolvedRef = { source, commitSha: 'sha-456' }

      vi.mocked(cacheModule.getCachedFiles).mockReturnValue(null)

      // Mock API strategy to succeed by returning a single-file response
      const fileData = {
        type: 'file',
        name: 'index.md',
        path: 'index.md',
        sha: 'abc',
        size: 5,
        content: Buffer.from('hello').toString('base64'),
        encoding: 'base64',
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue(fileData),
        })
      )

      await fetcherModule.fetchFiles(resolved)
      expect(cacheModule.cacheFiles).toHaveBeenCalledWith(
        source,
        'sha-456',
        expect.arrayContaining([expect.objectContaining({ path: 'index.md' })])
      )
    })

    it('falls back to next strategy when first fails', async () => {
      const source: GitSource = {
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        path: '',
        ref: 'main',
      }
      const resolved: ResolvedRef = { source, commitSha: 'sha-789' }

      vi.mocked(cacheModule.getCachedFiles).mockReturnValue(null)

      // First call (API strategy) fails, second call (archive tarball) fails,
      // then subsequent calls also fail — we just verify it tries multiple times
      let callCount = 0
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => {
          callCount++
          return Promise.reject(new Error(`fetch attempt ${callCount} failed`))
        })
      )

      const { execFile } = await import('node:child_process')
      vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback) => {
        const cb = typeof _opts === 'function' ? _opts : callback
        if (cb) cb(new Error('git failed'), '', '')
        return {} as ReturnType<typeof execFile>
      })

      await expect(fetcherModule.fetchFiles(resolved)).rejects.toThrow(
        'All fetch strategies exhausted'
      )

      // API and archive strategies both use fetch, so it should have been called multiple times
      expect(callCount).toBeGreaterThan(1)
    })

    it('throws when all strategies fail', async () => {
      const source: GitSource = {
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        path: '',
        ref: 'main',
      }

      const resolved: ResolvedRef = { source, commitSha: 'sha-123' }

      vi.mocked(cacheModule.getCachedFiles).mockReturnValue(null)

      // Mock fetch to fail for API and archive strategies
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

      // Mock execFile to fail for sparse-checkout and clone strategies
      const { execFile } = await import('node:child_process')
      vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback) => {
        const cb = typeof _opts === 'function' ? _opts : callback
        if (cb) cb(new Error('git failed'), '', '')
        return {} as ReturnType<typeof execFile>
      })

      await expect(fetcherModule.fetchFiles(resolved)).rejects.toThrow(
        'All fetch strategies exhausted'
      )
    })
  })
})
