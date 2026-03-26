import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import { AgentverError } from '@agentver/shared'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { getWorkingDirectory } from '../shared/context'
import { assertPathWithin, splitPackageName } from '../shared/validation'
import { readLockfile, readManifest, writeLockfile, writeManifest } from '../storage'

export function registerRemoveTool(server: McpServer): void {
  server.registerTool(
    'agentver_remove',
    {
      title: 'Agentver Remove',
      description:
        'Remove an installed package from the current project or global scope. ' +
        'Deletes skill files from all agent directories and updates the manifest and lockfile.',
      inputSchema: z.object({
        package: z
          .string()
          .describe('Package name in org/name format to remove (e.g. "my-org/typescript-rules")'),
        global: z
          .boolean()
          .optional()
          .describe('Set to true to remove a globally installed package'),
      }),
    },
    async ({ package: packageName, global: isGlobal }) => {
      const { pkg } = splitPackageName(packageName)

      const projectRoot = getWorkingDirectory()
      const manifest = readManifest(projectRoot)

      const installedPkg = manifest.packages[packageName]
      if (!installedPkg) {
        throw new AgentverError('NOT_FOUND', `Package "${packageName}" is not installed.`)
      }

      const shortName = pkg
      const removedFrom: string[] = []

      for (const agentId of installedPkg.agents) {
        const placementPath = getSkillPlacementPath(
          agentId as AgentId,
          shortName,
          isGlobal ? 'global' : 'project'
        )
        if (!placementPath) continue

        const fullPath = isGlobal
          ? placementPath.replace(/^~(?=\/|$)/, homedir())
          : join(projectRoot, placementPath)

        assertPathWithin(fullPath, isGlobal ? homedir() : projectRoot)

        if (existsSync(fullPath)) {
          rmSync(fullPath, { recursive: true, force: true })
          removedFrom.push(agentId)
        }
      }

      // Update manifest
      delete manifest.packages[packageName]
      writeManifest(projectRoot, manifest)

      // Update lockfile
      const lockfile = readLockfile(projectRoot)
      delete lockfile.packages[packageName]
      writeLockfile(projectRoot, lockfile)

      const summary = [
        `Removed ${packageName}`,
        removedFrom.length > 0
          ? `Cleaned up from: ${removedFrom.join(', ')}`
          : 'No agent directories required cleanup',
        `Scope: ${isGlobal ? 'global' : 'project'}`,
      ]

      return {
        content: [{ type: 'text' as const, text: summary.join('\n') }],
      }
    }
  )
}
