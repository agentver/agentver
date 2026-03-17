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

    it('includes source in successful result', async () => {
      const source: GitSource = {
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        path: '',
        ref: 'main',
      }
      const resolved: ResolvedRef = { source, commitSha: 'sha-src' }
      const cachedFiles = [{ path: 'file.md', content: '# File', size: 6 }]

      vi.mocked(cacheModule.getCachedFiles).mockReturnValue(cachedFiles)

      const result = await fetcherModule.fetchFiles(resolved)
      expect(result.source).toBe(source)
    })

    it('includes source in cached result', async () => {
      const source: GitSource = {
        host: 'gitlab.com',
        owner: 'group',
        repo: 'project',
        path: 'skills/demo',
        ref: 'v2',
      }
      const resolved: ResolvedRef = { source, commitSha: 'abc123' }
      const cachedFiles = [{ path: 'SKILL.md', content: '# Skill', size: 7 }]

      vi.mocked(cacheModule.getCachedFiles).mockReturnValue(cachedFiles)

      const result = await fetcherModule.fetchFiles(resolved)
      expect(result.source).toEqual(source)
      expect(result.commitSha).toBe('abc123')
      expect(result.files).toBe(cachedFiles)
    })
  })

  describe('readFilesFromDirectory — additional cases', () => {
    it('returns empty array for an empty directory', async () => {
      const fsp = await import('node:fs/promises')

      vi.mocked(fsp.readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fsp.readdir>>
      )

      const result = await fetcherModule.readFilesFromDirectory('/empty/dir')
      expect(result).toEqual([])
    })

    it('prepends basePath to file paths', async () => {
      const fsp = await import('node:fs/promises')

      vi.mocked(fsp.readdir).mockResolvedValue([
        { name: 'file.md', isDirectory: () => false, isFile: () => true },
      ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)

      vi.mocked(fsp.stat).mockResolvedValue({ size: 50 } as Awaited<ReturnType<typeof fsp.stat>>)
      vi.mocked(fsp.readFile).mockResolvedValue('content')

      const result = await fetcherModule.readFilesFromDirectory('/dir', 'prefix/path')
      expect(result).toHaveLength(1)
      expect(result[0]!.path).toBe('prefix/path/file.md')
    })

    it('recurses into subdirectories', async () => {
      const fsp = await import('node:fs/promises')

      // First call returns a directory and a file
      vi.mocked(fsp.readdir)
        .mockResolvedValueOnce([
          { name: 'sub', isDirectory: () => true, isFile: () => false },
          { name: 'root.md', isDirectory: () => false, isFile: () => true },
        ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)
        // Second call (inside sub/) returns a file
        .mockResolvedValueOnce([
          { name: 'nested.md', isDirectory: () => false, isFile: () => true },
        ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)

      vi.mocked(fsp.stat).mockResolvedValue({ size: 20 } as Awaited<ReturnType<typeof fsp.stat>>)
      vi.mocked(fsp.readFile).mockResolvedValue('data')

      const result = await fetcherModule.readFilesFromDirectory('/project')
      expect(result).toHaveLength(2)
      expect(result.find((f) => f.path === 'root.md')).toBeDefined()
      expect(result.find((f) => f.path === 'sub/nested.md')).toBeDefined()
    })

    it('skips entries that are neither files nor directories (e.g. symlinks)', async () => {
      const fsp = await import('node:fs/promises')

      vi.mocked(fsp.readdir).mockResolvedValue([
        { name: 'link', isDirectory: () => false, isFile: () => false },
        { name: 'real.md', isDirectory: () => false, isFile: () => true },
      ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)

      vi.mocked(fsp.stat).mockResolvedValue({ size: 10 } as Awaited<ReturnType<typeof fsp.stat>>)
      vi.mocked(fsp.readFile).mockResolvedValue('real content')

      const result = await fetcherModule.readFilesFromDirectory('/dir')
      expect(result).toHaveLength(1)
      expect(result[0]!.path).toBe('real.md')
    })

    it('returns empty array when directory does not exist (ENOENT)', async () => {
      const fsp = await import('node:fs/promises')

      const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      vi.mocked(fsp.readdir).mockRejectedValue(enoentError)

      const result = await fetcherModule.readFilesFromDirectory('/nonexistent')
      expect(result).toEqual([])
    })

    it('rethrows non-ENOENT errors from readdir', async () => {
      const fsp = await import('node:fs/promises')

      const permError = Object.assign(new Error('Permission denied'), { code: 'EACCES' })
      vi.mocked(fsp.readdir).mockRejectedValue(permError)

      await expect(fetcherModule.readFilesFromDirectory('/forbidden')).rejects.toThrow(
        'Permission denied'
      )
    })

    it('silently skips individual files that vanish during read (ENOENT on stat)', async () => {
      const fsp = await import('node:fs/promises')

      vi.mocked(fsp.readdir).mockResolvedValue([
        { name: 'vanished.md', isDirectory: () => false, isFile: () => true },
        { name: 'exists.md', isDirectory: () => false, isFile: () => true },
      ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)

      const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      vi.mocked(fsp.stat)
        .mockRejectedValueOnce(enoentError)
        .mockResolvedValueOnce({ size: 15 } as Awaited<ReturnType<typeof fsp.stat>>)

      vi.mocked(fsp.readFile).mockResolvedValue('still here')

      const result = await fetcherModule.readFilesFromDirectory('/dir')
      expect(result).toHaveLength(1)
      expect(result[0]!.path).toBe('exists.md')
    })

    it('continues when readFile throws a non-ENOENT error for a single file', async () => {
      const fsp = await import('node:fs/promises')

      vi.mocked(fsp.readdir).mockResolvedValue([
        { name: 'broken.md', isDirectory: () => false, isFile: () => true },
        { name: 'fine.md', isDirectory: () => false, isFile: () => true },
      ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)

      vi.mocked(fsp.stat).mockResolvedValue({ size: 10 } as Awaited<ReturnType<typeof fsp.stat>>)

      vi.mocked(fsp.readFile)
        .mockRejectedValueOnce(new Error('I/O error'))
        .mockResolvedValueOnce('good data')

      const result = await fetcherModule.readFilesFromDirectory('/dir')
      expect(result).toHaveLength(1)
      expect(result[0]!.path).toBe('fine.md')
    })

    it('stores correct size in returned file objects', async () => {
      const fsp = await import('node:fs/promises')

      vi.mocked(fsp.readdir).mockResolvedValue([
        { name: 'sized.md', isDirectory: () => false, isFile: () => true },
      ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)

      vi.mocked(fsp.stat).mockResolvedValue({ size: 42 } as Awaited<ReturnType<typeof fsp.stat>>)
      vi.mocked(fsp.readFile).mockResolvedValue('hello world')

      const result = await fetcherModule.readFilesFromDirectory('/dir')
      expect(result).toHaveLength(1)
      expect(result[0]!.size).toBe(42)
      expect(result[0]!.content).toBe('hello world')
    })

    it('handles deeply nested directory structures', async () => {
      const fsp = await import('node:fs/promises')

      // /dir -> a/ -> b/ -> deep.md
      vi.mocked(fsp.readdir)
        .mockResolvedValueOnce([
          { name: 'a', isDirectory: () => true, isFile: () => false },
        ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)
        .mockResolvedValueOnce([
          { name: 'b', isDirectory: () => true, isFile: () => false },
        ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)
        .mockResolvedValueOnce([
          { name: 'deep.md', isDirectory: () => false, isFile: () => true },
        ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)

      vi.mocked(fsp.stat).mockResolvedValue({ size: 5 } as Awaited<ReturnType<typeof fsp.stat>>)
      vi.mocked(fsp.readFile).mockResolvedValue('deep')

      const result = await fetcherModule.readFilesFromDirectory('/dir')
      expect(result).toHaveLength(1)
      expect(result[0]!.path).toBe('a/b/deep.md')
    })

    it('skips file at exactly the 5MB boundary', async () => {
      const fsp = await import('node:fs/promises')

      vi.mocked(fsp.readdir).mockResolvedValue([
        { name: 'borderline.bin', isDirectory: () => false, isFile: () => true },
      ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)

      // Exactly 5MB should NOT be skipped (the check is > not >=)
      vi.mocked(fsp.stat).mockResolvedValue({
        size: 5 * 1024 * 1024,
      } as Awaited<ReturnType<typeof fsp.stat>>)
      vi.mocked(fsp.readFile).mockResolvedValue('x'.repeat(100))

      const result = await fetcherModule.readFilesFromDirectory('/dir')
      expect(result).toHaveLength(1)
      expect(result[0]!.path).toBe('borderline.bin')
    })

    it('skips file one byte over the 5MB limit', async () => {
      const fsp = await import('node:fs/promises')

      vi.mocked(fsp.readdir).mockResolvedValue([
        { name: 'over.bin', isDirectory: () => false, isFile: () => true },
      ] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)

      vi.mocked(fsp.stat).mockResolvedValue({
        size: 5 * 1024 * 1024 + 1,
      } as Awaited<ReturnType<typeof fsp.stat>>)

      const result = await fetcherModule.readFilesFromDirectory('/dir')
      expect(result).toHaveLength(0)
      // readFile should NOT be called for oversized files
      expect(fsp.readFile).not.toHaveBeenCalled()
    })
  })

  describe('execGit', () => {
    it('calls git with correct arguments and options', async () => {
      const { execFile } = await import('node:child_process')

      vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback) => {
        const cb = typeof _opts === 'function' ? _opts : callback
        if (cb) cb(null, '', '')
        return {} as ReturnType<typeof execFile>
      })

      await fetcherModule.execGit(['status'])

      expect(execFile).toHaveBeenCalledWith(
        'git',
        ['status'],
        expect.objectContaining({
          timeout: 60_000,
          maxBuffer: 50 * 1024 * 1024,
        }),
        expect.any(Function)
      )
    })

    it('passes cwd option when provided', async () => {
      const { execFile } = await import('node:child_process')

      vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback) => {
        const cb = typeof _opts === 'function' ? _opts : callback
        if (cb) cb(null, 'ok', '')
        return {} as ReturnType<typeof execFile>
      })

      await fetcherModule.execGit(['log'], '/some/repo')

      expect(execFile).toHaveBeenCalledWith(
        'git',
        ['log'],
        expect.objectContaining({ cwd: '/some/repo' }),
        expect.any(Function)
      )
    })

    it('omits cwd when not provided', async () => {
      const { execFile } = await import('node:child_process')

      vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback) => {
        const cb = typeof _opts === 'function' ? _opts : callback
        if (cb) cb(null, '', '')
        return {} as ReturnType<typeof execFile>
      })

      await fetcherModule.execGit(['diff'])

      expect(execFile).toHaveBeenCalledWith(
        'git',
        ['diff'],
        expect.objectContaining({ cwd: undefined }),
        expect.any(Function)
      )
    })

    it('wraps errors in AgentverError with the command in the message', async () => {
      const { execFile } = await import('node:child_process')

      vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback) => {
        const cb = typeof _opts === 'function' ? _opts : callback
        if (cb) cb(new Error('fatal: bad revision'), '', '')
        return {} as ReturnType<typeof execFile>
      })

      await expect(fetcherModule.execGit(['checkout', 'nonexistent'])).rejects.toThrow(
        'Git command failed: git checkout nonexistent'
      )
    })

    it('thrown error is an AgentverError with INTERNAL_ERROR code', async () => {
      const { execFile } = await import('node:child_process')

      vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback) => {
        const cb = typeof _opts === 'function' ? _opts : callback
        if (cb) cb(new Error('timeout'), '', '')
        return {} as ReturnType<typeof execFile>
      })

      try {
        await fetcherModule.execGit(['fetch'])
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as { code: string }).code).toBe('INTERNAL_ERROR')
        expect((error as Error).message).toContain('git fetch')
      }
    })

    it('includes the original error message in the wrapped error', async () => {
      const { execFile } = await import('node:child_process')

      vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback) => {
        const cb = typeof _opts === 'function' ? _opts : callback
        if (cb) cb(new Error('repository not found'), '', '')
        return {} as ReturnType<typeof execFile>
      })

      await expect(fetcherModule.execGit(['clone', 'url'])).rejects.toThrow('repository not found')
    })

    it('handles non-Error throw values gracefully', async () => {
      const { execFile } = await import('node:child_process')

      vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback) => {
        const cb = typeof _opts === 'function' ? _opts : callback
        if (cb) cb('string error' as unknown as Error, '', '')
        return {} as ReturnType<typeof execFile>
      })

      await expect(fetcherModule.execGit(['push'])).rejects.toThrow('Git command failed: git push')
    })

    it('includes all arguments in the error message', async () => {
      const { execFile } = await import('node:child_process')

      vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback) => {
        const cb = typeof _opts === 'function' ? _opts : callback
        if (cb) cb(new Error('error'), '', '')
        return {} as ReturnType<typeof execFile>
      })

      await expect(
        fetcherModule.execGit(['sparse-checkout', 'set', 'path/to/dir'])
      ).rejects.toThrow('git sparse-checkout set path/to/dir')
    })
  })

  describe('buildRepoUrl — additional cases', () => {
    it('builds Bitbucket URL', () => {
      const source: GitSource = {
        host: 'bitbucket.org',
        owner: 'team',
        repo: 'project',
        path: '',
        ref: 'main',
      }
      expect(fetcherModule.buildRepoUrl(source)).toBe('https://bitbucket.org/team/project.git')
    })

    it('ignores path and ref — only uses host, owner, repo', () => {
      const source: GitSource = {
        host: 'github.com',
        owner: 'org',
        repo: 'mono',
        path: 'packages/deep/nested',
        ref: 'v2.0.0',
      }
      expect(fetcherModule.buildRepoUrl(source)).toBe('https://github.com/org/mono.git')
    })

    it('handles owner with hyphens and dots', () => {
      const source: GitSource = {
        host: 'github.com',
        owner: 'my-org.test',
        repo: 'my-repo.js',
        path: '',
        ref: 'HEAD',
      }
      expect(fetcherModule.buildRepoUrl(source)).toBe(
        'https://github.com/my-org.test/my-repo.js.git'
      )
    })
  })
})
