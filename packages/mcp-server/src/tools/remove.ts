import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import { AgentverError } from '@agentver/shared'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { getWorkingDirectory } from '../shared/context'
import { readLockfile, readManifest, writeLockfile, writeManifest } from '../storage'

/** Expand a leading ~ to the user's home directory */
function expandTilde(path: string): string {
  return path.replace(/^~/, homedir())
}

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
      const root = isGlobal ? join(homedir(), '.agentver') : getWorkingDirectory()
      const manifest = readManifest(root)

      const pkg = manifest.packages[packageName]
      if (!pkg) {
        throw new AgentverError('NOT_FOUND', `Package "${packageName}" is not installed.`)
      }

      const shortName = packageName.split('/').pop()!
      const removedFrom: string[] = []
      const scope = isGlobal ? 'global' : 'project'

      for (const agentId of pkg.agents) {
        const placementPath = getSkillPlacementPath(agentId as AgentId, shortName, scope)
        if (!placementPath) continue

        const fullPath = isGlobal ? expandTilde(placementPath) : join(root, placementPath)

        if (existsSync(fullPath)) {
          rmSync(fullPath, { recursive: true, force: true })
          removedFrom.push(agentId)
        }
      }

      // Update manifest
      delete manifest.packages[packageName]
      writeManifest(root, manifest)

      // Update lockfile
      const lockfile = readLockfile(root)
      delete lockfile.packages[packageName]
      writeLockfile(root, lockfile)

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
