import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillsShSearchResponse } from '@/lib/registries/skills-sh'
import { searchSkillsSh } from '@/lib/registries/skills-sh'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'
import { createUnauthenticatedCaller } from '~/test/helpers/trpc'

vi.mock('@/lib/registries/skills-sh', () => ({
  searchSkillsSh: vi.fn(),
}))

vi.mock('@/lib/redis/cache', () => ({
  withCache: vi.fn().mockImplementation((_key: string, _ttl: number, fn: () => unknown) => fn()),
}))

function makeSkillsShResponse(count = 3): SkillsShSearchResponse {
  return {
    skills: Array.from({ length: count }, (_, i) => ({
      id: `skill-${i}`,
      name: `skill-${i}`,
      description: `Description ${i}`,
      installCount: i * 100,
      source: `owner/repo-${i}`,
      url: `https://skills.sh/skill-${i}`,
    })),
    count,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ---------------------------------------------------------------------------
// search.featured
// ---------------------------------------------------------------------------

describe('search.featured', () => {
  it('returns skills from searchSkillsSh with default limit', async () => {
    const response = makeSkillsShResponse(3)
    vi.mocked(searchSkillsSh).mockResolvedValue(response)

    const caller = createUnauthenticatedCaller()
    const result = await caller.search.featured({})

    expect(result.skills).toHaveLength(3)
    expect(result.count).toBe(3)
  })

  it('passes an empty query string to searchSkillsSh', async () => {
    vi.mocked(searchSkillsSh).mockResolvedValue(makeSkillsShResponse())

    const caller = createUnauthenticatedCaller()
    await caller.search.featured({})

    expect(searchSkillsSh).toHaveBeenCalledWith('', expect.any(Number))
  })

  it('respects the limit input', async () => {
    vi.mocked(searchSkillsSh).mockResolvedValue(makeSkillsShResponse(5))

    const caller = createUnauthenticatedCaller()
    await caller.search.featured({ limit: 5 })

    expect(searchSkillsSh).toHaveBeenCalledWith('', 5)
  })

  it('returns empty result when searchSkillsSh returns empty', async () => {
    vi.mocked(searchSkillsSh).mockResolvedValue({ skills: [], count: 0 })

    const caller = createUnauthenticatedCaller()
    const result = await caller.search.featured({})

    expect(result.skills).toHaveLength(0)
    expect(result.count).toBe(0)
  })

  it('throws a validation error when limit is below 1', async () => {
    const caller = createUnauthenticatedCaller()

    await expect(caller.search.featured({ limit: 0 })).rejects.toThrow()
  })

  it('throws a validation error when limit is above 20', async () => {
    const caller = createUnauthenticatedCaller()

    await expect(caller.search.featured({ limit: 21 })).rejects.toThrow()
  })

  it('is accessible without authentication', async () => {
    vi.mocked(searchSkillsSh).mockResolvedValue(makeSkillsShResponse())

    const caller = createUnauthenticatedCaller()

    await expect(caller.search.featured({})).resolves.toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// search.searchExternal
// ---------------------------------------------------------------------------

describe('search.searchExternal', () => {
  it('returns skills matching the query', async () => {
    const response = makeSkillsShResponse(2)
    vi.mocked(searchSkillsSh).mockResolvedValue(response)

    const caller = createUnauthenticatedCaller()
    const result = await caller.search.searchExternal({ query: 'typescript' })

    expect(result.skills).toHaveLength(2)
    expect(result.count).toBe(2)
  })

  it('passes the query string through to searchSkillsSh', async () => {
    vi.mocked(searchSkillsSh).mockResolvedValue(makeSkillsShResponse())

    const caller = createUnauthenticatedCaller()
    await caller.search.searchExternal({ query: 'deploy-helper' })

    expect(searchSkillsSh).toHaveBeenCalledWith('deploy-helper', expect.any(Number))
  })

  it('throws a validation error when query is an empty string', async () => {
    const caller = createUnauthenticatedCaller()

    await expect(caller.search.searchExternal({ query: '' })).rejects.toThrow()
  })
})
