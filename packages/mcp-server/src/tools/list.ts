import { homedir } from 'node:os'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { getWorkingDirectory } from '../shared/context'
import { readManifest } from '../storage'

export function registerListTool(server: McpServer): void {
  server.registerTool(
    'agentver_list',
    {
      title: 'Agentver List',
      description:
        'List all installed Agentver packages in the current project (or globally). ' +
        'Shows package name, version, and target agents.',
      inputSchema: z.object({
        global: z
          .boolean()
          .optional()
          .describe(
            'Set to true to list globally installed packages instead of project-level ones'
          ),
      }),
    },
    async ({ global: isGlobal }) => {
      const root = isGlobal ? join(homedir(), '.agentver') : getWorkingDirectory()
      const manifest = readManifest(root)
      const packages = Object.values(manifest.packages)

      if (packages.length === 0) {
        const scope = isGlobal ? 'globally' : 'in this project'
        return {
          content: [{ type: 'text', text: `No packages installed ${scope}.` }],
        }
      }

      const lines = packages.map((pkg) => {
        const agents = pkg.agents.length > 0 ? ` [${pkg.agents.join(', ')}]` : ''
        return `- ${pkg.name}@${pkg.version}${agents}`
      })

      const scope = isGlobal ? 'Global' : 'Project'
      const header = `${scope} packages (${packages.length}):\n`
      return {
        content: [{ type: 'text', text: header + lines.join('\n') }],
      }
    }
  )
}
