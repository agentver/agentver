import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks
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
import { registerInfoTool } from '../../tools/info'

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
      const handler = handlers.get('agentver_info')
      if (!handler) throw new Error('Info tool was not registered')
      return handler
    },
  }
}

describe('info tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers the agentver_info tool on the server', () => {
    const { server } = createMockServer()
    registerInfoTool(server as never)
    expect(server.registerTool).toHaveBeenCalledWith(
      'agentver_info',
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('returns detailed package information', async () => {
    const { server, getHandler } = createMockServer()
    registerInfoTool(server as never)

    vi.mocked(registryModule.registryFetch).mockResolvedValue({
      id: 'pkg-1',
      name: 'typescript-rules',
      slug: 'typescript-rules',
      description: 'TypeScript linting rules',
      type: 'SKILL',
      visibility: 'PUBLIC',
      tags: ['typescript', 'linting'],
      readme: '# TypeScript Rules',
      organisation: { slug: 'my-org', name: 'My Org' },
      author: { name: 'Jane Doe', image: null },
      versions: [
        {
          version: '1.2.0',
          changelog: 'Added new rules',
          createdAt: '2025-01-15T00:00:00Z',
          sha256: 'abc',
        },
        {
          version: '1.1.0',
          changelog: null,
          createdAt: '2025-01-10T00:00:00Z',
          sha256: 'def',
        },
      ],
      _count: { installationReports: 200, forks: 5 },
    })

    const handler = getHandler()
    const result = await handler({ package: 'my-org/typescript-rules' })

    expect(result.content).toHaveLength(1)
    const text = result.content[0]!.text

    expect(text).toContain('my-org/typescript-rules')
    expect(text).toContain('TypeScript linting rules')
    expect(text).toContain('Type: SKILL')
    expect(text).toContain('Latest: 1.2.0')
    expect(text).toContain('Author: Jane Doe')
    expect(text).toContain('Downloads: 200')
    expect(text).toContain('Forks: 5')
    expect(text).toContain('typescript, linting')
    expect(text).toContain('1.2.0')
    expect(text).toContain('1.1.0')
    expect(text).toContain('agentver install my-org/typescript-rules')
  })

  it('returns an error for invalid package names', async () => {
    const { server, getHandler } = createMockServer()
    registerInfoTool(server as never)

    const handler = getHandler()
    const result = await handler({ package: 'invalid-name' })

    expect(result.content[0]!.text).toContain('Invalid package name')
  })

  it('rejects package names with path traversal', async () => {
    const { server, getHandler } = createMockServer()
    registerInfoTool(server as never)

    const handler = getHandler()
    const result = await handler({ package: '../etc/passwd' })

    expect(result.content[0]!.text).toContain('Invalid package name')
    expect(registryModule.registryFetch).not.toHaveBeenCalled()
  })

  it('uses organisation name when author is null', async () => {
    const { server, getHandler } = createMockServer()
    registerInfoTool(server as never)

    vi.mocked(registryModule.registryFetch).mockResolvedValue({
      id: 'pkg-1',
      name: 'skill',
      slug: 'skill',
      description: 'A skill',
      type: 'SKILL',
      visibility: 'PUBLIC',
      tags: [],
      readme: null,
      organisation: { slug: 'org', name: 'The Org' },
      author: null,
      versions: [
        { version: '1.0.0', changelog: null, createdAt: '2025-01-01T00:00:00Z', sha256: null },
      ],
      _count: { installationReports: 0, forks: 0 },
    })

    const handler = getHandler()
    const result = await handler({ package: 'org/skill' })

    expect(result.content[0]!.text).toContain('Author: The Org')
  })

  it('handles packages with no tags or versions', async () => {
    const { server, getHandler } = createMockServer()
    registerInfoTool(server as never)

    vi.mocked(registryModule.registryFetch).mockResolvedValue({
      id: 'pkg-1',
      name: 'skill',
      slug: 'skill',
      description: null,
      type: 'SKILL',
      visibility: 'PUBLIC',
      tags: [],
      readme: null,
      organisation: { slug: 'org', name: 'Org' },
      author: null,
      versions: [],
      _count: { installationReports: 0, forks: 0 },
    })

    const handler = getHandler()
    const result = await handler({ package: 'org/skill' })

    expect(result.content[0]!.text).toContain('Tags: none')
    expect(result.content[0]!.text).toContain('Latest: none')
    expect(result.content[0]!.text).toContain('No description')
  })
})
