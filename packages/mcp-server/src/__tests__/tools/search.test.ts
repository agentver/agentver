import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockServer } from '../helpers/mock-server'

vi.mock('../../shared/registry', () => ({
  registryFetch: vi.fn(),
}))

describe('tools/search', () => {
  let registryMod: typeof import('../../shared/registry')
  let handler: (...args: unknown[]) => unknown

  beforeEach(async () => {
    vi.clearAllMocks()
    registryMod = await import('../../shared/registry')
    const { registerSearchTool } = await import('../../tools/search')
    const { server, getHandler } = createMockServer()
    registerSearchTool(server)
    handler = getHandler('agentver_search')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns formatted results when search finds matches', async () => {
    vi.mocked(registryMod.registryFetch).mockResolvedValue({
      results: [
        {
          slug: 'org/skill-a',
          description: 'A skill',
          version: '1.0.0',
          type: 'SKILL',
          downloads: 100,
        },
      ],
      total: 1,
    })

    const result = (await handler({ query: 'test' })) as { content: Array<{ text: string }> }
    expect(result.content[0].text).toContain('org/skill-a@1.0.0')
    expect(result.content[0].text).toContain('100 downloads')
  })

  it('returns "No results found" when results empty', async () => {
    vi.mocked(registryMod.registryFetch).mockResolvedValue({ results: [], total: 0 })

    const result = (await handler({ query: 'nonexistent' })) as { content: Array<{ text: string }> }
    expect(result.content[0].text).toContain('No results found')
  })

  it('passes query parameter to registry', async () => {
    vi.mocked(registryMod.registryFetch).mockResolvedValue({ results: [], total: 0 })

    await handler({ query: 'my-search' })

    expect(registryMod.registryFetch).toHaveBeenCalledWith(expect.stringContaining('q=my-search'))
  })

  it('passes type parameter uppercased when provided', async () => {
    vi.mocked(registryMod.registryFetch).mockResolvedValue({ results: [], total: 0 })

    await handler({ query: 'test', type: 'skill' })

    expect(registryMod.registryFetch).toHaveBeenCalledWith(expect.stringContaining('type=SKILL'))
  })

  it('passes limit parameter when provided', async () => {
    vi.mocked(registryMod.registryFetch).mockResolvedValue({ results: [], total: 0 })

    await handler({ query: 'test', limit: 5 })

    expect(registryMod.registryFetch).toHaveBeenCalledWith(expect.stringContaining('limit=5'))
  })

  it('only sends q param when no type or limit', async () => {
    vi.mocked(registryMod.registryFetch).mockResolvedValue({ results: [], total: 0 })

    await handler({ query: 'test' })

    const calledPath = vi.mocked(registryMod.registryFetch).mock.calls[0]![0] as string
    expect(calledPath).toBe('/skills?q=test')
  })
})
