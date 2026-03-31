import { detectInstalledAgents } from '@agentver/agent-definitions'
import { executeInstall, type InstallRequest, planInstall } from '@agentver/installer'
import type { GitSource } from '@agentver/shared'
import { AgentverError, createLogger } from '@agentver/shared'
import { computeIntegrity, createStablePackageKey } from '@agentver/storage'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { getWorkingDirectory } from '../shared/context'
import { isAuthenticated, registryFetch } from '../shared/registry'

type DownloadResponse = {
  version: string
  content: string | null
  fileManifest: Record<string, unknown> | Array<{ path: string; content: string }>
  sha256: string | null
  size: number | null
  gitRef: string | null
  gitCommitSha: string | null
  gitUri: string | null
  gitPath: string | null
  createdAt: string
}

type VersionListResponse = {
  versions: Array<{
    version: string
    status: string
  }>
}

const SAFE_PACKAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const logger = createLogger('mcp-server:install')

function extractFilesFromManifest(
  fileManifest: Record<string, unknown> | unknown[]
): Array<{ path: string; content: string }> {
  if (Array.isArray(fileManifest)) {
    return fileManifest.filter((entry): entry is { path: string; content: string } => {
      if (typeof entry !== 'object' || entry === null) return false
      const record = entry as Record<string, unknown>
      return typeof record.path === 'string' && typeof record.content === 'string'
    })
  }

  return Object.entries(fileManifest)
    .filter(([, value]) => typeof value === 'string')
    .map(([path, content]) => ({ path, content: content as string }))
}

async function resolveLatestVersion(org: string, name: string): Promise<string> {
  const data = await registryFetch<VersionListResponse>(
    `/skills/${encodeURIComponent(org)}/${encodeURIComponent(name)}/versions`
  )

  const available = data.versions.filter((v) => v.status !== 'YANKED')
  if (available.length === 0) {
    throw new AgentverError('NOT_FOUND', `No published versions found for ${org}/${name}`)
  }

  return available[0]!.version
}

export function registerInstallTool(server: McpServer): void {
  server.registerTool(
    'agentver_install',
    {
      title: 'Agentver Install',
      description:
        'Install a package from the Agentver registry into the current project. ' +
        'Resolves the version, downloads files, places them into detected agent directories, ' +
        'and updates the manifest and lockfile.',
      inputSchema: z.object({
        package: z
          .string()
          .describe('Package name in org/name format (e.g. "my-org/typescript-rules")'),
        version: z
          .string()
          .optional()
          .describe('Semver version to install (e.g. "1.2.0"). Defaults to latest if omitted'),
        agents: z
          .array(z.string())
          .optional()
          .describe(
            'Target agent IDs to install for (e.g. ["claude-code", "cursor"]). Omit to auto-detect installed agents'
          ),
        global: z
          .boolean()
          .optional()
          .describe(
            'Set to true to install globally for all projects instead of current project only'
          ),
      }),
    },
    async ({ package: packageName, version, agents: targetAgents, global: isGlobal }) => {
      if (!isAuthenticated()) {
        throw new AgentverError(
          'UNAUTHORISED',
          'Not authenticated. Run `agentver login` in your terminal first.'
        )
      }

      if (!SAFE_PACKAGE_NAME.test(packageName)) {
        throw new AgentverError(
          'VALIDATION_ERROR',
          `Invalid package name "${packageName}". Must be in org/name format using alphanumeric characters, hyphens, dots, or underscores.`
        )
      }

      const [org, name] = packageName.split('/') as [string, string]
      const projectRoot = getWorkingDirectory()

      const resolvedVersion = version ?? (await resolveLatestVersion(org, name))

      const data = await registryFetch<DownloadResponse>(
        `/skills/${encodeURIComponent(org)}/${encodeURIComponent(name)}/${encodeURIComponent(resolvedVersion)}/download`
      )

      // Validate required fields before any file I/O
      if (!data.gitUri || !data.gitRef || !data.gitCommitSha || !data.sha256) {
        throw new AgentverError(
          'VALIDATION_ERROR',
          `Registry response for ${packageName}@${data.version} is missing required fields (git provenance or sha256) for manifest v2.`
        )
      }

      const files = extractFilesFromManifest(data.fileManifest)

      if (files.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Package ${packageName}@${data.version} has no files in its file manifest.`,
            },
          ],
        }
      }

      const resolvedAgents = targetAgents ?? detectInstalledAgents(projectRoot).map((a) => a.id)

      if (resolvedAgents.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No AI agents detected in this project. Specify target agents explicitly or ensure agent config directories exist.',
            },
          ],
        }
      }

      const source: GitSource = {
        type: 'git',
        uri: data.gitUri,
        path: data.gitPath ?? '',
        ref: data.gitRef,
        commit: data.gitCommitSha,
      }

      const request: InstallRequest = {
        packageKey: createStablePackageKey(packageName, source),
        displayName: packageName,
        packageType: 'SKILL',
        source,
        files,
        integrity: computeIntegrity(files),
        target: {
          scope: isGlobal ? 'global' : 'project',
          projectRoot,
          agents: resolvedAgents,
        },
        policy: {
          conflictStrategy: 'error',
          preferredLinkMode: 'copy',
          allowFallback: true,
          dryRun: false,
          persist: true,
          securityScanPolicy: 'skip',
        },
      }

      const plan = planInstall(request)

      if (!plan.executable) {
        throw new AgentverError(
          'CONFLICT',
          plan.blockedReason ?? 'Installation blocked due to conflicts'
        )
      }

      if (plan.skippedAgents.length > 0) {
        for (const skipped of plan.skippedAgents) {
          logger.debug(`Skipped agent ${skipped.agentId}: ${skipped.reason}`)
        }
      }

      const result = executeInstall(plan)

      if (!result.success) {
        throw new AgentverError('INTERNAL_ERROR', result.error?.message ?? 'Installation failed')
      }

      // Clean up any backup handles from a successful install
      for (const backup of result.backups) {
        backup.cleanup()
      }

      const installedAgents = result.placements.filter((p) => p.success).map((p) => p.agentId)

      const summary = [
        `Installed ${packageName}@${data.version}`,
        `Target agents: ${installedAgents.join(', ')}`,
        `Files: ${result.filesPlacedCount} file(s) placed`,
        `Scope: ${isGlobal ? 'global' : 'project'}`,
      ]

      return {
        content: [{ type: 'text' as const, text: summary.join('\n') }],
      }
    }
  )
}
