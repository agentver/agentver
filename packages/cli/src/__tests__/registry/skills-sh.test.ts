import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillsShResult } from '../../registry/skills-sh'
import { searchSkillsSh, toGitInstallSource } from '../../registry/skills-sh'

describe('skills-sh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('toGitInstallSource', () => {
    it('builds a GitHub git source from result', () => {
      const result: SkillsShResult = {
        id: 'abc123',
        name: 'my-skill',
        description: '',
        installCount: 42,
        source: 'owner/repo',
        url: 'https://skills.sh/abc123',
      }

      expect(toGitInstallSource(result)).toBe('github.com/owner/repo/my-skill')
    })
  })

  describe('searchSkillsSh', () => {
    it('returns results from the skills.sh API', async () => {
      const apiResponse = {
        query: 'test',
        searchType: 'keyword',
        skills: [
          {
            id: 'skill-1',
            skillId: 'sid-1',
            name: 'test-skill',
            installs: 100,
            source: 'owner/repo',
          },
        ],
        count: 1,
        duration_ms: 50,
      }

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue(apiResponse),
        })
      )

      const results = await searchSkillsSh('test')
      expect(results).toHaveLength(1)
      expect(results[0]!.name).toBe('test-skill')
      expect(results[0]!.installCount).toBe(100)
      expect(results[0]!.url).toBe('https://skills.sh/skill-1')
    })

    it('returns empty array on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

      const results = await searchSkillsSh('test')
      expect(results).toEqual([])
    })

    it('returns empty array on non-OK response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        })
      )

      const results = await searchSkillsSh('test')
      expect(results).toEqual([])
    })

    it('returns empty array on invalid response schema', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({ invalid: true }),
        })
      )

      const results = await searchSkillsSh('test')
      expect(results).toEqual([])
    })

    it('passes limit as query parameter', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          query: 'test',
          searchType: 'keyword',
          skills: [],
          count: 0,
          duration_ms: 10,
        }),
      })

      vi.stubGlobal('fetch', mockFetch)

      await searchSkillsSh('test', 5)

      const url = mockFetch.mock.calls[0]![0] as string
      expect(url).toContain('limit=5')
    })

    it('URL-encodes the search query', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          query: 'my skill',
          searchType: 'keyword',
          skills: [],
          count: 0,
          duration_ms: 10,
        }),
      })

      vi.stubGlobal('fetch', mockFetch)

      await searchSkillsSh('my skill')

      const url = mockFetch.mock.calls[0]![0] as string
      // Space should be encoded as %20 or +
      expect(url).not.toContain(' ')
      expect(url).toMatch(/my(%20|\+)skill/)
    })
  })
})
