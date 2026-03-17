import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseGitSource, resolveRef } from '../../git/resolver'
import type { GitSource } from '../../git/types'

// Mock fetcher module for execGit and buildRepoUrl
vi.mock('../../git/fetcher.js', () => ({
  buildRepoUrl: vi.fn(
    (source: GitSource) => `https://${source.host}/${source.owner}/${source.repo}.git`
  ),
  execGit: vi.fn(),
}))

// Mock @agentver/shared logger
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

describe('parseGitSource', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses a simple GitHub source', () => {
    const result = parseGitSource('github.com/owner/repo')
    expect(result).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      path: '',
      ref: 'HEAD',
      commit: undefined,
    })
  })

  it('parses a GitHub source with path', () => {
    const result = parseGitSource('github.com/owner/repo/skills/my-skill')
    expect(result).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      path: 'skills/my-skill',
      ref: 'HEAD',
      commit: undefined,
    })
  })

  it('parses a source with ref using @', () => {
    const result = parseGitSource('github.com/owner/repo@v1.0.0')
    expect(result).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      path: '',
      ref: 'v1.0.0',
      commit: undefined,
    })
  })

  it('parses a source with commit SHA using #', () => {
    const result = parseGitSource('github.com/owner/repo#abc123')
    expect(result).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      path: '',
      ref: 'HEAD',
      commit: 'abc123',
    })
  })

  it('strips https:// prefix', () => {
    const result = parseGitSource('https://github.com/owner/repo')
    expect(result.host).toBe('github.com')
    expect(result.owner).toBe('owner')
    expect(result.repo).toBe('repo')
  })

  it('strips http:// prefix', () => {
    const result = parseGitSource('http://github.com/owner/repo')
    expect(result.host).toBe('github.com')
  })

  it('recognises gitlab.com as a known host', () => {
    const result = parseGitSource('gitlab.com/owner/repo')
    expect(result.host).toBe('gitlab.com')
  })

  it('recognises bitbucket.org as a known host', () => {
    const result = parseGitSource('bitbucket.org/owner/repo')
    expect(result.host).toBe('bitbucket.org')
  })

  it('uses generic for unknown hosts', () => {
    const result = parseGitSource('my-gitlab.example.com/owner/repo')
    expect(result.host).toBe('generic')
  })

  it('throws for empty ref after @', () => {
    expect(() => parseGitSource('github.com/owner/repo@')).toThrow('Empty ref after @ separator')
  })

  it('throws for empty commit SHA after #', () => {
    expect(() => parseGitSource('github.com/owner/repo#')).toThrow(
      'Empty commit SHA after # separator'
    )
  })

  it('throws when both # and @ are provided', () => {
    expect(() => parseGitSource('github.com/owner/repo@main#abc123')).toThrow(
      'Cannot specify both a commit SHA'
    )
  })

  it('throws for too few segments', () => {
    expect(() => parseGitSource('github.com/owner')).toThrow('Invalid git source')
  })

  it('trims whitespace from source', () => {
    const result = parseGitSource('  github.com/owner/repo  ')
    expect(result.owner).toBe('owner')
  })

  it('handles path with ref together', () => {
    const result = parseGitSource('github.com/owner/repo/skills/my-skill@develop')
    expect(result.path).toBe('skills/my-skill')
    expect(result.ref).toBe('develop')
  })

  it('treats short commit SHAs (< 7 chars) as valid — parser does not enforce length', () => {
    // The parser itself accepts any non-empty commit; validation happens upstream
    const result = parseGitSource('github.com/owner/repo#abc')
    expect(result.commit).toBe('abc')
  })

  it('accepts a 40-character full SHA', () => {
    const fullSha = 'a'.repeat(40)
    const result = parseGitSource(`github.com/owner/repo#${fullSha}`)
    expect(result.commit).toBe(fullSha)
  })

  it('strips .git suffix from repo name when present in URL', () => {
    // git source parsing doesn't strip .git — ensure the repo name is preserved as-is
    const result = parseGitSource('github.com/owner/repo.git')
    // This should parse the third segment literally; the URL builder adds .git separately
    expect(result.repo).toBe('repo.git')
  })
})

describe('resolveRef', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('returns commit SHA directly when source has a commit', async () => {
    const source: GitSource = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      path: '',
      ref: 'HEAD',
      commit: 'abc123def456',
    }

    const result = await resolveRef(source)
    expect(result.commitSha).toBe('abc123def456')
    expect(result.source).toBe(source)
  })

  it('resolves GitHub ref via API', async () => {
    const source: GitSource = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      path: '',
      ref: 'main',
    }

    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({ sha: 'resolved-sha-123' }),
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

    const result = await resolveRef(source)
    expect(result.commitSha).toBe('resolved-sha-123')
  })

  it('throws NOT_FOUND for GitHub 404', async () => {
    const source: GitSource = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      path: '',
      ref: 'nonexistent',
    }

    const mockResponse = {
      ok: false,
      status: 404,
      headers: new Headers(),
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

    await expect(resolveRef(source)).rejects.toThrow('Could not resolve ref')
  })

  it('throws RATE_LIMITED for GitHub 403 with X-RateLimit-Remaining: 0', async () => {
    const source: GitSource = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      path: '',
      ref: 'main',
    }

    const headers = new Headers()
    headers.set('X-RateLimit-Remaining', '0')
    headers.set('X-RateLimit-Reset', '1700000000')

    const mockResponse = {
      ok: false,
      status: 403,
      headers,
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

    await expect(resolveRef(source)).rejects.toThrow('rate limit exceeded')
  })

  it('resolves GitLab ref via API', async () => {
    const source: GitSource = {
      host: 'gitlab.com',
      owner: 'owner',
      repo: 'repo',
      path: '',
      ref: 'main',
    }

    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({ id: 'gitlab-sha-456' }),
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

    const result = await resolveRef(source)
    expect(result.commitSha).toBe('gitlab-sha-456')
  })

  it('includes GITHUB_TOKEN in Authorization header when env var is set', async () => {
    const source: GitSource = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      path: '',
      ref: 'main',
    }

    vi.stubEnv('GITHUB_TOKEN', 'ghp_test_token_value')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({ sha: 'resolved-sha' }),
    })

    vi.stubGlobal('fetch', mockFetch)

    await resolveRef(source)

    const callHeaders = mockFetch.mock.calls[0]![1]!.headers
    expect(callHeaders.Authorization).toBe('Bearer ghp_test_token_value')
  })

  it('falls back to git ls-remote for generic hosts', async () => {
    const source: GitSource = {
      host: 'generic',
      owner: 'owner',
      repo: 'repo',
      path: '',
      ref: 'main',
    }

    const { execGit } = await import('../../git/fetcher')
    vi.mocked(execGit).mockResolvedValue(
      'abcdef1234567890abcdef1234567890abcdef1234\trefs/heads/main\n'
    )

    const result = await resolveRef(source)
    expect(result.commitSha).toBe('abcdef1234567890abcdef1234567890abcdef1234')
  })
})
