import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  type AgentId,
  detectInstalledAgents,
  getSkillPlacementPath,
} from '@agentver/agent-definitions'
import { AgentverError, PACKAGE_STRUCTURES } from '@agentver/shared'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { getWorkingDirectory } from '../shared/context'
import { getRegistryUrl, isAuthenticated, registryFetch } from '../shared/registry'
import { assertPathWithin, expandTilde, splitPackageName } from '../shared/validation'
import { readLockfile, readManifest, writeLockfile, writeManifest } from '../storage'

type VersionsResponse = {
  versions: Array<{
    version: string
    changelog: string | null
    status: string
    sha256: string | null
    size: number | null
    gitRef: string | null
    gitCommitSha: string | null
    createdAt: string
  }>
}

type DownloadResponse = {
  version: string
  content: string | null
  fileManifest: Record<string, unknown> | null
  sha256: string | null
  size: number | null
  gitRef: string | null
  gitCommitSha: string | null
  gitUri: string | null
  gitPath: string | null
  createdAt: string
}

async function resolveLatestVersion(org: string, name: string): Promise<string> {
  const data = await registryFetch<VersionsResponse>(
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

      if (!data.content && data.gitUri) {
        throw new AgentverError(
          'VALIDATION_ERROR',
          `Package ${packageName}@${data.version} is stored in git (${data.gitUri}). ` +
            'Use the CLI to install git-native packages: agentver install ' +
            packageName
        )
      }

      if (!data.content) {
        throw new AgentverError(
          'NOT_FOUND',
          `Package ${packageName}@${data.version} has no content available for download.`
        )
      }

      const entryFile = PACKAGE_STRUCTURES.SKILL?.entryFile ?? 'SKILL.md'

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

      const shortName = pkg
      const installedTo: string[] = []

      for (const agentId of detectedAgents) {
        const placementPath = getSkillPlacementPath(
          agentId as AgentId,
          shortName,
          isGlobal ? 'global' : 'project'
        )
        if (!placementPath) continue

        const fullPath = isGlobal ? expandTilde(placementPath) : join(projectRoot, placementPath)

        assertPathWithin(fullPath, isGlobal ? homedir() : projectRoot)

        if (!existsSync(fullPath)) {
          mkdirSync(fullPath, { recursive: true })
        }

        const filePath = resolve(fullPath, entryFile)
        assertPathWithin(filePath, fullPath)

        const dir = dirname(filePath)
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true })
        }

        writeFileSync(filePath, data.content, 'utf-8')
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
      const integrity = data.sha256
        ? `sha256-${data.sha256}`
        : `sha256-${createHash('sha256').update(data.content).digest('hex')}`

      const lockfile = readLockfile(projectRoot)
      lockfile.packages[packageName] = {
        version: data.version,
        resolved: `${getRegistryUrl()}/skills/${encodeURIComponent(org)}/${encodeURIComponent(pkg)}/${encodeURIComponent(data.version)}/download`,
        integrity,
        agents: installedTo,
      }
      writeLockfile(projectRoot, lockfile)

      const summary = [
        `Installed ${packageName}@${data.version}`,
        `Target agents: ${installedTo.join(', ')}`,
        `Files: ${entryFile}`,
        `Scope: ${isGlobal ? 'global' : 'project'}`,
      ]

      return {
        content: [{ type: 'text' as const, text: summary.join('\n') }],
      }
    }
  )
}
