import { AgentverError } from '@agentver/shared'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { getWorkingDirectory } from '../shared/context'
import { isAuthenticated, registryFetch } from '../shared/registry'
import { readManifest } from '../storage'

type UpdateCheckResponse = {
  updates: Array<{
    name: string
    current: string
    latest: string
  }>
}

export function registerUpdateTool(server: McpServer): void {
  server.registerTool(
    'agentver_update',
    {
      title: 'Agentver Update',
      description:
        'Check for updates to installed Agentver packages. ' +
        'Optionally specify a single package name, or check all installed packages. ' +
        'Returns a list of packages with available updates.',
      inputSchema: z.object({
        package: z
          .string()
          .optional()
          .describe(
            'Package name in org/name format to check for updates (omit to check all installed packages)'
          ),
      }),
    },
    async ({ package: packageName }) => {
      if (!isAuthenticated()) {
        throw new AgentverError(
          'UNAUTHORISED',
          'Not authenticated. Run `agentver login` in your terminal first.'
        )
      }

      const projectRoot = getWorkingDirectory()
      const manifest = readManifest(projectRoot)

      const packageEntries = packageName
        ? { [packageName]: manifest.packages[packageName] }
        : manifest.packages

      const packageNames = Object.keys(packageEntries).filter(
        (name) => packageEntries[name] !== undefined
      )

      if (packageNames.length === 0) {
        const msg = packageName
          ? `Package "${packageName}" is not installed.`
          : 'No packages installed.'
        return {
          content: [{ type: 'text', text: msg }],
        }
      }

      const data = await registryFetch<UpdateCheckResponse>('/skills/check-updates', {
        method: 'POST',
        body: {
          packages: packageNames.map((name) => ({
            name,
            version: packageEntries[name]!.version,
          })),
        },
      })

      if (data.updates.length === 0) {
        return {
          content: [{ type: 'text', text: 'All packages are up to date.' }],
        }
      }

      const lines = data.updates.map(
        (update) => `- ${update.name}: ${update.current} -> ${update.latest}`
      )

      const header = `Updates available (${data.updates.length}):\n`
      const footer = '\nRun agentver_install for each package to apply the update.'

      return {
        content: [{ type: 'text', text: header + lines.join('\n') + footer }],
      }
    }
  )
}
