import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchWellKnownIndex,
  looksLikeWellKnownUrl,
  parseWellKnownSource,
} from '../../wellknown/resolver'

vi.mock('@agentver/shared', () => ({
  AgentverError: class AgentverError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
      this.name = 'AgentverError'
    }
  },
}))

describe('looksLikeWellKnownUrl', () => {
  it('returns true for a bare domain', () => {
    expect(looksLikeWellKnownUrl('example.com')).toBe(true)
  })

  it('returns true for domain/skill-name', () => {
    expect(looksLikeWellKnownUrl('example.com/my-skill')).toBe(true)
  })

  it('returns true for https:// prefixed URL', () => {
    expect(looksLikeWellKnownUrl('https://example.com')).toBe(true)
  })

  it('returns true for http:// prefixed URL', () => {
    expect(looksLikeWellKnownUrl('http://example.com')).toBe(true)
  })

  it('returns false for github.com', () => {
    expect(looksLikeWellKnownUrl('github.com')).toBe(false)
  })

  it('returns false for gitlab.com', () => {
    expect(looksLikeWellKnownUrl('gitlab.com')).toBe(false)
  })

  it('returns false for bitbucket.org', () => {
    expect(looksLikeWellKnownUrl('bitbucket.org')).toBe(false)
  })

  it('returns false for URLs ending with .git', () => {
    expect(looksLikeWellKnownUrl('example.com/repo.git')).toBe(false)
  })

  it('returns false when there is no dot in the host', () => {
    expect(looksLikeWellKnownUrl('localhost')).toBe(false)
  })

  it('returns false for too many segments (3+)', () => {
    expect(looksLikeWellKnownUrl('example.com/a/b/c')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(looksLikeWellKnownUrl('')).toBe(false)
  })

  it('handles trailing slash', () => {
    expect(looksLikeWellKnownUrl('example.com/')).toBe(true)
  })
})

describe('parseWellKnownSource', () => {
  it('parses bare domain', () => {
    const result = parseWellKnownSource('example.com')
    expect(result).toEqual({ baseUrl: 'https://example.com' })
  })

  it('parses domain with skill name', () => {
    const result = parseWellKnownSource('example.com/my-skill')
    expect(result).toEqual({
      baseUrl: 'https://example.com',
      skillName: 'my-skill',
    })
  })

  it('strips https:// prefix', () => {
    const result = parseWellKnownSource('https://example.com/my-skill')
    expect(result.baseUrl).toBe('https://example.com')
    expect(result.skillName).toBe('my-skill')
  })

  it('strips http:// prefix', () => {
    const result = parseWellKnownSource('http://example.com')
    expect(result.baseUrl).toBe('https://example.com')
  })

  it('strips trailing slash', () => {
    const result = parseWellKnownSource('example.com/')
    expect(result.baseUrl).toBe('https://example.com')
    expect(result.skillName).toBeUndefined()
  })
})

describe('fetchWellKnownIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches and validates a well-known index', async () => {
    const mockIndex = {
      skills: [
        {
          name: 'my-skill',
          description: 'A test skill',
          files: ['index.md'],
        },
      ],
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockIndex),
      })
    )

    const result = await fetchWellKnownIndex('https://example.com')
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]!.name).toBe('my-skill')
  })

  it('throws on non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })
    )

    await expect(fetchWellKnownIndex('https://example.com')).rejects.toThrow(
      'No well-known skills index found'
    )
  })

  it('throws on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network fail')))

    await expect(fetchWellKnownIndex('https://example.com')).rejects.toThrow(
      'Failed to fetch well-known index'
    )
  })

  it('throws on invalid index schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ invalid: true }),
      })
    )

    await expect(fetchWellKnownIndex('https://example.com')).rejects.toThrow(
      'Invalid well-known skills index'
    )
  })

  it('upgrades http to https in the outgoing request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        skills: [{ name: 'test', description: 'test', files: ['a.md'] }],
      }),
    })

    vi.stubGlobal('fetch', mockFetch)

    await fetchWellKnownIndex('http://example.com')

    const calledUrl = mockFetch.mock.calls[0]![0] as string
    expect(calledUrl.startsWith('https://')).toBe(true)
    expect(calledUrl).not.toContain('http://')
    expect(calledUrl).toBe('https://example.com/.well-known/skills/index.json')
  })

  it('rejects an index with missing required fields in skill entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          skills: [{ name: 'test' }], // missing description and files
        }),
      })
    )

    await expect(fetchWellKnownIndex('https://example.com')).rejects.toThrow(
      'Invalid well-known skills index'
    )
  })

  it('rejects an index with empty skills array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          skills: [],
        }),
      })
    )

    await expect(fetchWellKnownIndex('https://example.com')).rejects.toThrow(
      'Invalid well-known skills index'
    )
  })

  it('rejects skill entries with empty files array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          skills: [{ name: 'test', description: 'test', files: [] }],
        }),
      })
    )

    await expect(fetchWellKnownIndex('https://example.com')).rejects.toThrow(
      'Invalid well-known skills index'
    )
  })

  it('rejects skill names that do not match the naming pattern', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          skills: [{ name: 'INVALID NAME!', description: 'test', files: ['a.md'] }],
        }),
      })
    )

    await expect(fetchWellKnownIndex('https://example.com')).rejects.toThrow(
      'Invalid well-known skills index'
    )
  })
})
