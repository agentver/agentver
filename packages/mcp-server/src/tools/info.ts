import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { registryFetch } from '../shared/registry'

/** Matches the GET /skills/{org}/{name} response from the platform API */
type PackageInfoResponse = {
  id: string
  name: string
  slug: string
  description: string | null
  type: string
  visibility: string
  tags: string[]
  readme: string | null
  organisation: { slug: string; name: string }
  author: { name: string | null; image: string | null } | null
  versions: Array<{
    version: string
    changelog: string | null
    createdAt: string
    sha256: string | null
  }>
  _count: { installationReports: number; forks: number }
}

const SAFE_PACKAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function registerInfoTool(server: McpServer): void {
  server.registerTool(
    'agentver_info',
    {
      title: 'Agentver Info',
      description:
        'Get detailed information about a specific package from the Agentver registry. ' +
        'Returns description, all versions, tags, download count, and install command.',
      inputSchema: z.object({
        package: z
          .string()
          .describe('Package name in org/name format to look up (e.g. "my-org/typescript-rules")'),
      }),
    },
    async ({ package: packageName }) => {
      if (!SAFE_PACKAGE_NAME.test(packageName)) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid package name "${packageName}". Must be in org/name format.`,
            },
          ],
        }
      }

      const [org, name] = packageName.split('/') as [string, string]
      const encodedOrg = encodeURIComponent(org)
      const encodedName = encodeURIComponent(name)

      const data = await registryFetch<PackageInfoResponse>(`/skills/${encodedOrg}/${encodedName}`)

      const latestVersion = data.versions[0]?.version ?? 'none'
      const authorName = data.author?.name ?? data.organisation.name
      const downloads = data._count.installationReports

      const versionList = data.versions.map((v) => `  ${v.version} (${v.createdAt})`).join('\n')

      const lines = [
        `${data.organisation.slug}/${data.name} — ${data.description ?? 'No description'}`,
        '',
        `Type: ${data.type}`,
        `Latest: ${latestVersion}`,
        `Author: ${authorName}`,
        `Downloads: ${downloads}`,
        `Forks: ${data._count.forks}`,
        `Visibility: ${data.visibility}`,
        `Tags: ${data.tags.length > 0 ? data.tags.join(', ') : 'none'}`,
        '',
        'Versions:',
        versionList || '  (none)',
        '',
        `Install: agentver install ${data.organisation.slug}/${data.name}`,
      ]

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      }
    }
  )
}
