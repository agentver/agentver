import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { logDebug } from './shared/context'
import { registerInfoTool } from './tools/info'
import { registerInstallTool } from './tools/install'
import { registerListTool } from './tools/list'
import { registerRemoveTool } from './tools/remove'
import { registerSearchTool } from './tools/search'

declare const __PKG_VERSION__: string

const SERVER_NAME = 'agentver'
const SERVER_VERSION = __PKG_VERSION__

async function main(): Promise<void> {
  logDebug(`Starting ${SERVER_NAME} MCP server v${SERVER_VERSION}`)

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: { logging: {} },
    }
  )

  // Register all tools
  registerSearchTool(server)
  registerInstallTool(server)
  registerListTool(server)
  registerRemoveTool(server)
  registerInfoTool(server)
  // Connect via stdio transport (standard for MCP)
  const transport = new StdioServerTransport()
  await server.connect(transport)

  logDebug('MCP server connected via stdio')
}

main().catch((error: unknown) => {
  logDebug(`Fatal error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
