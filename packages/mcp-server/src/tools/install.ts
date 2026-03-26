import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  type AgentId,
  detectInstalledAgents,
  getSkillPlacementPath,
} from '@agentver/agent-definitions'
import { AgentverError } from '@agentver/shared'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { getWorkingDirectory } from '../shared/context'
import { isAuthenticated, registryFetch } from '../shared/registry'
import { readLockfile, readManifest, writeLockfile, writeManifest } from '../storage'

type DownloadResponse = {
  version: string
  content: string | null
  fileManifest: Record<string, unknown>
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

function splitPackageName(name: string): { org: string; pkg: string } {
  const parts = name.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new AgentverError(
      'VALIDATION_ERROR',
      `Invalid package name "${name}": expected "org/name" format`
    )
  }
  return { org: parts[0], pkg: parts[1] }
}

function extractFilesFromManifest(
  fileManifest: Record<string, unknown>
): Array<{ path: string; content: string }> {
  if (Array.isArray(fileManifest)) {
    return fileManifest.filter(
      (entry): entry is { path: string; content: string } =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.path === 'string' &&
        typeof entry.content === 'string'
    )
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

      const { org, pkg } = splitPackageName(packageName)
      const projectRoot = getWorkingDirectory()

      const resolvedVersion = version ?? (await resolveLatestVersion(org, pkg))

      const data = await registryFetch<DownloadResponse>(
        `/skills/${encodeURIComponent(org)}/${encodeURIComponent(pkg)}/${encodeURIComponent(resolvedVersion)}/download`
      )

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

      const detectedAgents = targetAgents ?? detectInstalledAgents(projectRoot).map((a) => a.id)

      if (detectedAgents.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No AI agents detected in this project. Specify target agents explicitly or ensure agent config directories exist.',
            },
          ],
        }
      }

      const shortName = packageName.split('/').pop()!
      const installedTo: string[] = []

      for (const agentId of detectedAgents) {
        const placementPath = getSkillPlacementPath(
          agentId as AgentId,
          shortName,
          isGlobal ? 'global' : 'project'
        )
        if (!placementPath) continue

        const fullPath = isGlobal
          ? placementPath.replace('~', process.env.HOME ?? '')
          : join(projectRoot, placementPath)

        if (!existsSync(fullPath)) {
          mkdirSync(fullPath, { recursive: true })
        }

        const resolvedBase = resolve(fullPath)

        for (const file of files) {
          if (file.path.includes('..')) continue

          const filePath = resolve(fullPath, file.path)
          if (!filePath.startsWith(`${resolvedBase}/`) && filePath !== resolvedBase) continue

          const dir = dirname(filePath)
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true })
          }
          writeFileSync(filePath, file.content, 'utf-8')
        }

        installedTo.push(agentId)
      }

      // Update manifest
      const manifest = readManifest(projectRoot)
      manifest.packages[packageName] = {
        name: packageName,
        version: data.version,
        agents: installedTo,
        installedAt: new Date().toISOString(),
      }
      writeManifest(projectRoot, manifest)

      // Update lockfile
      const lockfile = readLockfile(projectRoot)
      lockfile.packages[packageName] = {
        version: data.version,
        resolved: `/skills/${encodeURIComponent(org)}/${encodeURIComponent(pkg)}/${encodeURIComponent(data.version)}/download`,
        integrity: '',
        agents: installedTo,
      }
      writeLockfile(projectRoot, lockfile)

      const summary = [
        `Installed ${packageName}@${data.version}`,
        `Target agents: ${installedTo.join(', ')}`,
        `Files: ${files.length} file(s) placed`,
        `Scope: ${isGlobal ? 'global' : 'project'}`,
      ]

      return {
        content: [{ type: 'text' as const, text: summary.join('\n') }],
      }
    }
  )
}
