import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import { AgentverError } from '@agentver/shared'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { getWorkingDirectory } from '../shared/context'
import { readLockfile, readManifest, writeLockfile, writeManifest } from '../storage'

export function registerRemoveTool(server: McpServer): void {
  server.registerTool(
    'agentver_remove',
    {
      title: 'Agentver Remove',
      description:
        'Remove an installed package from the current project. ' +
        'Deletes skill files from all agent directories and updates the manifest and lockfile.',
      inputSchema: z.object({
        package: z
          .string()
          .describe('Package name in org/name format to remove (e.g. "my-org/typescript-rules")'),
      }),
    },
    async ({ package: packageName }) => {
      const projectRoot = getWorkingDirectory()
      const manifest = readManifest(projectRoot)

      const pkg = manifest.packages[packageName]
      if (!pkg) {
        throw new AgentverError('NOT_FOUND', `Package "${packageName}" is not installed.`)
      }

      const shortName = packageName.split('/').pop()!
      const removedFrom: string[] = []

      for (const agentId of pkg.agents) {
        const placementPath = getSkillPlacementPath(agentId as AgentId, shortName, 'project')
        if (!placementPath) continue

        const fullPath = join(projectRoot, placementPath)
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
      ]

      return {
        content: [{ type: 'text', text: summary.join('\n') }],
      }
    }
  )
}
