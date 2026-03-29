import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../shared/context', () => ({
  getWorkingDirectory: vi.fn(),
  logDebug: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import * as contextModule from '../../shared/context'
import { registerListTool } from '../../tools/list'

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
      const handler = handlers.get('agentver_list')
      if (!handler) throw new Error('List tool was not registered')
      return handler
    },
  }
}

describe('list tool', () => {
  let tempDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tempDir = join(
      tmpdir(),
      `agentver-list-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    mkdirSync(tempDir, { recursive: true })
    vi.mocked(contextModule.getWorkingDirectory).mockReturnValue(tempDir)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('registers the agentver_list tool on the server', () => {
    const { server } = createMockServer()
    registerListTool(server as never)
    expect(server.registerTool).toHaveBeenCalledWith(
      'agentver_list',
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('returns "no packages installed" when manifest is empty', async () => {
    const { server, getHandler } = createMockServer()
    registerListTool(server as never)

    const handler = getHandler()
    const result = await handler({})

    expect(result.content[0]!.text).toContain('No packages installed in this project')
  })

  it('returns a valid response when global flag is set', async () => {
    const { server, getHandler } = createMockServer()
    registerListTool(server as never)

    const handler = getHandler()
    const result = await handler({ global: true })

    // The handler reads from homedir — there may or may not be packages globally
    // but the function should not throw
    expect(result.content).toHaveLength(1)
  })

  it('lists installed packages with their source and agents', async () => {
    const agentverDir = join(tempDir, '.agentver')
    mkdirSync(agentverDir, { recursive: true })

    const manifest = {
      version: 2,
      packages: {
        'my-org/typescript-rules': {
          source: {
            type: 'git',
            uri: 'https://github.com/org/repo',
            path: 'skills/typescript-rules',
            ref: 'v1.0.0',
            commit: 'abc1234def',
          },
          agents: ['claude-code', 'cursor'],
          installedAt: new Date().toISOString(),
          modified: false,
        },
        'my-org/react-patterns': {
          source: {
            type: 'git',
            uri: 'https://github.com/org/repo2',
            path: 'skills/react-patterns',
            ref: 'v2.0.0',
            commit: 'def4567abc',
          },
          agents: ['claude-code'],
          installedAt: new Date().toISOString(),
          modified: false,
        },
      },
    }

    writeFileSync(join(agentverDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8')

    const { server, getHandler } = createMockServer()
    registerListTool(server as never)

    const handler = getHandler()
    const result = await handler({})

    const text = result.content[0]!.text
    expect(text).toContain('Project packages (2)')
    expect(text).toContain('my-org/typescript-rules')
    expect(text).toContain('my-org/react-patterns')
    expect(text).toContain('claude-code')
    expect(text).toContain('cursor')
  })
})
