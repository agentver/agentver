import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
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
import { readLockfile, readManifest, writeLockfile, writeManifest } from '../storage'

/** Matches the GET /skills/{org}/{name}/versions response */
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

/** Matches the GET /skills/{org}/{name}/{version}/download response */
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

const SAFE_PACKAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** Validate that a resolved path stays within the expected base directory */
function assertPathWithin(filePath: string, baseDir: string): void {
  const resolved = resolve(filePath)
  const resolvedBase = resolve(baseDir)
  if (!resolved.startsWith(`${resolvedBase}/`) && resolved !== resolvedBase) {
    throw new AgentverError(
      'VALIDATION_ERROR',
      `Path traversal detected: "${filePath}" escapes base directory`
    )
  }
}

/** Expand a leading ~ to the user's home directory */
function expandTilde(path: string): string {
  return path.replace(/^~/, homedir())
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
      const encodedOrg = encodeURIComponent(org)
      const encodedName = encodeURIComponent(name)

      const versionSpec = version ?? 'latest'
      const projectRoot = getWorkingDirectory()

      // Step 1: Resolve version — if "latest", fetch version list and pick the first
      let resolvedVersion: string
      if (versionSpec === 'latest') {
        const versionsData = await registryFetch<VersionsResponse>(
          `/skills/${encodedOrg}/${encodedName}/versions`
        )

        const latestEntry = versionsData.versions[0]
        if (!latestEntry) {
          throw new AgentverError('NOT_FOUND', `No versions found for package "${packageName}".`)
        }

        resolvedVersion = latestEntry.version
      } else {
        resolvedVersion = versionSpec
      }

      // Step 2: Download the version content
      const encodedVersion = encodeURIComponent(resolvedVersion)
      const data = await registryFetch<DownloadResponse>(
        `/skills/${encodedOrg}/${encodedName}/${encodedVersion}/download`
      )

      if (!data.content) {
        if (data.gitUri) {
          throw new AgentverError(
            'INTERNAL_ERROR',
            `Package "${packageName}@${resolvedVersion}" is a git-native package and cannot be installed via MCP. Use the CLI: agentver install ${packageName}`
          )
        }
        throw new AgentverError(
          'INTERNAL_ERROR',
          `No content available for "${packageName}@${resolvedVersion}".`
        )
      }

      const detectedAgents = targetAgents ?? detectInstalledAgents(projectRoot).map((a) => a.id)

      if (detectedAgents.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No AI agents detected in this project. Specify target agents explicitly or ensure agent config directories exist.',
            },
          ],
        }
      }

      const shortName = name
      const installedTo: string[] = []

      // Determine entry file name from package type (default to SKILL)
      const entryFile = PACKAGE_STRUCTURES.SKILL?.entryFile ?? 'SKILL.md'

      for (const agentId of detectedAgents) {
        const placementPath = getSkillPlacementPath(
          agentId as AgentId,
          shortName,
          isGlobal ? 'global' : 'project'
        )
        if (!placementPath) continue

        const fullPath = isGlobal ? expandTilde(placementPath) : join(projectRoot, placementPath)

        // Validate path stays within expected boundaries
        // Global paths resolve to agent-specific dirs under home (e.g. ~/.claude/skills/)
        const baseDir = isGlobal ? homedir() : projectRoot
        assertPathWithin(fullPath, baseDir)

        if (!existsSync(fullPath)) {
          mkdirSync(fullPath, { recursive: true })
        }

        const filePath = join(fullPath, entryFile)
        assertPathWithin(filePath, fullPath)
        writeFileSync(filePath, data.content, 'utf-8')

        installedTo.push(agentId)
      }

      // Update manifest
      const root = isGlobal ? join(homedir(), '.agentver') : projectRoot
      const manifest = readManifest(root)
      manifest.packages[packageName] = {
        name: packageName,
        version: data.version,
        agents: installedTo,
        installedAt: new Date().toISOString(),
      }
      writeManifest(root, manifest)

      // Update lockfile
      const downloadUrl = `${getRegistryUrl()}/skills/${encodedOrg}/${encodedName}/${encodedVersion}/download`
      const lockfile = readLockfile(root)
      lockfile.packages[packageName] = {
        version: data.version,
        resolved: downloadUrl,
        integrity: `sha256-${data.sha256 ?? 'unverified'}`,
        agents: installedTo,
      }
      writeLockfile(root, lockfile)

      const summary = [
        `Installed ${packageName}@${data.version}`,
        `Target agents: ${installedTo.join(', ')}`,
        `Entry file: ${entryFile}`,
        `Scope: ${isGlobal ? 'global' : 'project'}`,
      ]

      return {
        content: [{ type: 'text', text: summary.join('\n') }],
      }
    }
  )
}
