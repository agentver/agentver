import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import type { PackageType } from '@agentver/installer'
import {
  getCanonicalFilePath,
  getCanonicalSkillPath,
  removeAgentPlacements,
  resolveCanonicalCategory,
} from '@agentver/installer'
import { AgentverError } from '@agentver/shared'
import { resolvePackageQuery } from '@agentver/storage'
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
      const root = isGlobal ? homedir() : getWorkingDirectory()
      const manifest = readManifest(root)
      const lookup = resolvePackageQuery(manifest.packages, packageName)

      if (!lookup.ok) {
        if (lookup.reason === 'ambiguous') {
          throw new AgentverError(
            'AMBIGUOUS_SKILL',
            `Multiple packages match "${packageName}": ${lookup.matches.join(', ')}. Use the full package key to disambiguate.`
          )
        }
        throw new AgentverError('NOT_FOUND', `Package "${packageName}" is not installed.`)
      }

      const { key: packageKey, displayName, pkg } = lookup
      const scope = isGlobal ? 'global' : 'project'
      const packageType = (pkg.packageType ?? 'SKILL') as PackageType
      const category = resolveCanonicalCategory(packageType)

      // Remove canonical storage directory
      const canonicalPath =
        category === 'skills'
          ? getCanonicalSkillPath(root, displayName, scope)
          : getCanonicalFilePath(root, displayName, category, scope)
      if (existsSync(canonicalPath)) {
        rmSync(canonicalPath, { recursive: true, force: true })
      }

      // Remove agent placements (symlinks or copies) via installer
      removeAgentPlacements(root, displayName, pkg.agents, scope, category)

      // Fall back to legacy direct placement removal for packages installed
      // before the canonical storage migration
      const removedFrom: string[] = []
      for (const agentId of pkg.agents) {
        const placementPath = getSkillPlacementPath(agentId as AgentId, displayName, scope)
        if (!placementPath) continue

        const fullPath = isGlobal
          ? placementPath.replace(/^~/, homedir())
          : join(root, placementPath)

        if (existsSync(fullPath)) {
          rmSync(fullPath, { recursive: true, force: true })
          removedFrom.push(agentId)
        }
      }

      // Update manifest
      delete manifest.packages[packageKey]
      writeManifest(root, manifest)

      // Update lockfile
      const lockfile = readLockfile(root)
      delete lockfile.packages[packageKey]
      writeLockfile(root, lockfile)

      const summary = [
        `Removed ${displayName}`,
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
