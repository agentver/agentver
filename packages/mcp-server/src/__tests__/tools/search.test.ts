import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any import of the SUT
// ---------------------------------------------------------------------------

vi.mock('../../shared/registry', () => ({
  registryFetch: vi.fn(),
  isAuthenticated: vi.fn(),
  getCredentials: vi.fn(),
  getRegistryUrl: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import * as registryModule from '../../shared/registry'
import { registerSearchTool } from '../../tools/search'

// ---------------------------------------------------------------------------
// McpServer stub
// ---------------------------------------------------------------------------

type ToolHandler = (
  args: Record<string, unknown>
) => Promise<{ content: Array<{ type: string; text: string }> }>

function createMockServer(): {
  server: { registerTool: ReturnType<typeof vi.fn> }
  getHandler: () => ToolHandler
} {
  const handlers = new Map<string, ToolHandler>()

  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler)
    }),
  }

  return {
    server,
    getHandler: () => {
      const handler = handlers.get('agentver_search')
      if (!handler) throw new Error('Search tool was not registered')
      return handler
    },
  }
}

describe('search tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers the agentver_search tool on the server', () => {
    const { server } = createMockServer()
    registerSearchTool(server as never)
    expect(server.registerTool).toHaveBeenCalledWith(
      'agentver_search',
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('returns formatted results when search finds packages', async () => {
    const { server, getHandler } = createMockServer()
    registerSearchTool(server as never)

    vi.mocked(registryModule.registryFetch).mockResolvedValue({
      results: [
        {
          slug: 'org/typescript-rules',
          description: 'TypeScript linting rules',
          version: '1.2.0',
          type: 'SKILL',
          downloads: 150,
        },
        {
          slug: 'org/react-patterns',
          description: 'React best practices',
          version: '2.0.0',
          type: 'SKILL',
          downloads: 300,
        },
      ],
      total: 2,
    })

    const handler = getHandler()
    const result = await handler({ query: 'typescript' })

    expect(result.content).toHaveLength(1)
    expect(result.content[0]!.type).toBe('text')
    expect(result.content[0]!.text).toContain('Found 2 result(s)')
    expect(result.content[0]!.text).toContain('org/typescript-rules@1.2.0')
    expect(result.content[0]!.text).toContain('org/react-patterns@2.0.0')
    expect(result.content[0]!.text).toContain('150 downloads')
    expect(result.content[0]!.text).toContain('300 downloads')
  })

  it('returns a no-results message when nothing matches', async () => {
    const { server, getHandler } = createMockServer()
    registerSearchTool(server as never)

    vi.mocked(registryModule.registryFetch).mockResolvedValue({
      results: [],
      total: 0,
    })

    const handler = getHandler()
    const result = await handler({ query: 'nonexistent-package' })

    expect(result.content).toHaveLength(1)
    expect(result.content[0]!.text).toContain('No results found for "nonexistent-package"')
  })

  it('passes the type filter as an uppercase query parameter', async () => {
    const { server, getHandler } = createMockServer()
    registerSearchTool(server as never)

    vi.mocked(registryModule.registryFetch).mockResolvedValue({
      results: [],
      total: 0,
    })

    const handler = getHandler()
    await handler({ query: 'test', type: 'skill' })

    expect(registryModule.registryFetch).toHaveBeenCalledOnce()
    const callPath = vi.mocked(registryModule.registryFetch).mock.calls[0]![0] as string
    expect(callPath).toContain('type=SKILL')
  })

  it('passes the limit parameter', async () => {
    const { server, getHandler } = createMockServer()
    registerSearchTool(server as never)

    vi.mocked(registryModule.registryFetch).mockResolvedValue({
      results: [],
      total: 0,
    })

    const handler = getHandler()
    await handler({ query: 'test', limit: 5 })

    const callPath = vi.mocked(registryModule.registryFetch).mock.calls[0]![0] as string
    expect(callPath).toContain('limit=5')
  })

  it('includes descriptions in results when present', async () => {
    const { server, getHandler } = createMockServer()
    registerSearchTool(server as never)

    vi.mocked(registryModule.registryFetch).mockResolvedValue({
      results: [
        {
          slug: 'org/skill',
          description: 'A useful skill',
          version: '1.0.0',
          type: 'SKILL',
          downloads: 10,
        },
      ],
      total: 1,
    })

    const handler = getHandler()
    const result = await handler({ query: 'skill' })

    expect(result.content[0]!.text).toContain('A useful skill')
  })

  it('handles results without descriptions', async () => {
    const { server, getHandler } = createMockServer()
    registerSearchTool(server as never)

    vi.mocked(registryModule.registryFetch).mockResolvedValue({
      results: [
        {
          slug: 'org/skill',
          description: '',
          version: '1.0.0',
          type: 'SKILL',
          downloads: 10,
        },
      ],
      total: 1,
    })

    const handler = getHandler()
    const result = await handler({ query: 'skill' })

    expect(result.content[0]!.text).toContain('org/skill@1.0.0')
  })
})
