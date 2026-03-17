import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { registryFetch } from '../shared/registry'

type SearchResult = {
  slug: string
  description: string
  version: string
  type: string
  downloads: number
}

type SearchResponse = {
  results: SearchResult[]
  total: number
}

export function registerSearchTool(server: McpServer): void {
  server.registerTool(
    'agentver_search',
    {
      title: 'Agentver Search',
      description:
        'Search the Agentver registry for agent skills, configs, plugins, scripts, and prompts. ' +
        'Returns matching packages with name, description, version, type, and download count.',
      inputSchema: z.object({
        query: z.string().describe('Search term to find packages by name or description'),
        type: z
          .enum(['skill', 'agent_config', 'plugin', 'script', 'prompt'])
          .optional()
          .describe('Filter by package type: skill, agent_config, plugin, script, or prompt'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Maximum number of results to return, between 1 and 50 (default 10)'),
      }),
    },
    async ({ query, type, limit }) => {
      const params = new URLSearchParams({ q: query })
      if (type) params.set('type', type.toUpperCase())
      if (limit) params.set('limit', String(limit))

      const data = await registryFetch<SearchResponse>(`/skills?${params.toString()}`)

      if (data.results.length === 0) {
        return {
          content: [{ type: 'text', text: `No results found for "${query}".` }],
        }
      }

      const lines = data.results.map((result) => {
        const desc = result.description ? ` — ${result.description}` : ''
        return `- ${result.slug}@${result.version} [${result.type}] (${result.downloads} downloads)${desc}`
      })

      const header = `Found ${data.total} result(s) for "${query}":\n`
      return {
        content: [{ type: 'text', text: header + lines.join('\n') }],
      }
    }
  )
}
