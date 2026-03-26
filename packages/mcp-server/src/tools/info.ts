import { AgentverError } from '@agentver/shared'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { registryFetch } from '../shared/registry'
import { SAFE_PACKAGE_NAME, splitPackageName } from '../shared/validation'

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
        throw new AgentverError(
          'VALIDATION_ERROR',
          `Invalid package name "${packageName}": expected "org/name" format with alphanumeric, hyphens, underscores, or dots only`
        )
      }

      const { org, pkg } = splitPackageName(packageName)

      const data = await registryFetch<PackageInfoResponse>(
        `/skills/${encodeURIComponent(org)}/${encodeURIComponent(pkg)}`
      )

      const latestVersion = data.versions[0]?.version ?? 'none'
      const authorName = data.author?.name ?? data.organisation.name
      const downloads = data._count.installationReports
      const forks = data._count.forks

      const versionList = data.versions
        .map((v) => `  ${v.version} (${new Date(v.createdAt).toLocaleDateString()})`)
        .join('\n')

      const lines = [
        `${data.organisation.slug}/${data.name} — ${data.description ?? 'No description'}`,
        '',
        `Type: ${data.type}`,
        `Latest: ${latestVersion}`,
        `Author: ${authorName}`,
        `Downloads: ${downloads}`,
        `Forks: ${forks}`,
        `Visibility: ${data.visibility}`,
        `Tags: ${data.tags.length > 0 ? data.tags.join(', ') : 'none'}`,
        '',
        'Versions:',
        versionList || '  No versions published',
        '',
        `Install: agentver install ${data.organisation.slug}/${data.name}`,
      ]

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      }
    }
  )
}
