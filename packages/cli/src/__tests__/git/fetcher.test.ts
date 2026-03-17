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
