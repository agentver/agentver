import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { vi } from 'vitest'

type ToolHandler = (...args: unknown[]) => unknown

type MockServerResult = {
  server: McpServer
  getHandler: (toolName: string) => ToolHandler
}

export function createMockServer(): MockServerResult {
  const handlers = new Map<string, ToolHandler>()

  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler)
    }),
  } as unknown as McpServer

  return {
    server,
    getHandler: (name: string) => {
      const handler = handlers.get(name)
      if (!handler) throw new Error(`Tool "${name}" not registered`)
      return handler
    },
  }
}
