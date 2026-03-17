import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { registryFetch } from '../shared/registry'

type SkillInfoResponse = {
  slug: string
  name: string
  description: string
  type: string
  visibility: string
  latestVersion: string
  versions: Array<{
    version: string
    createdAt: string
  }>
  agents: string[]
  downloads: number
  author: string
  tags: string[]
}

export function registerInfoTool(server: McpServer): void {
  server.registerTool(
    'agentver_info',
    {
      title: 'Agentver Info',
      description:
        'Get detailed information about a specific package from the Agentver registry. ' +
        'Returns description, all versions, compatible agents, tags, download count, and install command.',
      inputSchema: z.object({
        package: z
          .string()
          .describe('Package name in org/name format to look up (e.g. "my-org/typescript-rules")'),
      }),
    },
    async ({ package: packageName }) => {
      const data = await registryFetch<SkillInfoResponse>(`/skills/${packageName}`)

      const versionList = data.versions.map((v) => `  ${v.version} (${v.createdAt})`).join('\n')

      const lines = [
        `${data.slug} — ${data.description}`,
        '',
        `Type: ${data.type}`,
        `Latest: ${data.latestVersion}`,
        `Author: ${data.author}`,
        `Downloads: ${data.downloads}`,
        `Visibility: ${data.visibility}`,
        `Tags: ${data.tags.length > 0 ? data.tags.join(', ') : 'none'}`,
        `Compatible agents: ${data.agents.length > 0 ? data.agents.join(', ') : 'all'}`,
        '',
        'Versions:',
        versionList,
        '',
        `Install: agentver install ${data.slug}`,
      ]

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    }
  )
}
