import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

type VersionResponse = {
  version: string
  downloadUrl: string
  sha256: string
  fileManifest: Array<{ path: string; content: string }>
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

      const versionSpec = version ?? 'latest'
      const projectRoot = getWorkingDirectory()

      const data = await registryFetch<VersionResponse>(
        `/skills/${packageName}/versions?version=${versionSpec}`
      )

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

        for (const file of data.fileManifest) {
          const filePath = join(fullPath, file.path)
          const dir = join(fullPath, file.path, '..')
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
        resolved: data.downloadUrl,
        integrity: `sha256-${data.sha256}`,
        agents: installedTo,
      }
      writeLockfile(projectRoot, lockfile)

      const summary = [
        `Installed ${packageName}@${data.version}`,
        `Target agents: ${installedTo.join(', ')}`,
        `Files: ${data.fileManifest.length} file(s) placed`,
        `Scope: ${isGlobal ? 'global' : 'project'}`,
      ]

      return {
        content: [{ type: 'text', text: summary.join('\n') }],
      }
    }
  )
}
