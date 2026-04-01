import { homedir } from 'node:os'
import { getPackageSourceLocation, getPackageSourceReference } from '@agentver/shared'
import { getPackageDisplayName } from '@agentver/storage'
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
        'Shows package name, source, and target agents.',
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
      const root = isGlobal ? homedir() : getWorkingDirectory()
      const manifest = readManifest(root)
      const entries = Object.entries(manifest.packages)

      if (entries.length === 0) {
        const scope = isGlobal ? 'globally' : 'in this project'
        return {
          content: [{ type: 'text' as const, text: `No packages installed ${scope}.` }],
        }
      }

      const lines = entries.map(([name, pkg]) => {
        const displayName = getPackageDisplayName(name, pkg)
        const agents = pkg.agents.length > 0 ? ` [${pkg.agents.join(', ')}]` : ''
        const sourceInfo =
          pkg.source.type === 'git' || pkg.source.type === 'platform'
            ? `${getPackageSourceLocation(pkg.source)}@${getPackageSourceReference(pkg.source)}`
            : getPackageSourceLocation(pkg.source)
        return `- ${displayName} (${sourceInfo})${agents}`
      })

      const scope = isGlobal ? 'Global' : 'Project'
      const header = `${scope} packages (${entries.length}):\n`
      return {
        content: [{ type: 'text' as const, text: header + lines.join('\n') }],
      }
    }
  )
}
