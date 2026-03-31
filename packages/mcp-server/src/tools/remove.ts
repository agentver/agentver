import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import { AgentverError, getPackageDisplayName } from '@agentver/shared'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { getWorkingDirectory } from '../shared/context'
import { readLockfile, readManifest, writeLockfile, writeManifest } from '../storage'

function findPackageEntry(
  packages: Record<
    string,
    {
      name?: string
      agents: string[]
    }
  >,
  query: string
): { key: string; displayName: string; pkg: { name?: string; agents: string[] } } | null {
  if (query in packages) {
    const pkg = packages[query]!
    return { key: query, displayName: getPackageDisplayName(query, pkg), pkg }
  }

  const matches = Object.entries(packages).filter(
    ([key, pkg]) => getPackageDisplayName(key, pkg) === query
  )

  if (matches.length !== 1) {
    return null
  }

  const [key, pkg] = matches[0]!
  return { key, displayName: getPackageDisplayName(key, pkg), pkg }
}

/** Expand a leading ~ to the user's home directory */
function expandTilde(path: string): string {
  return path.replace(/^~/, homedir())
}

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
      const packageEntry = findPackageEntry(manifest.packages, packageName)

      if (!packageEntry) {
        throw new AgentverError('NOT_FOUND', `Package "${packageName}" is not installed.`)
      }

      const { key: packageKey, displayName, pkg } = packageEntry
      const shortName = displayName.split('/').pop()!
      const removedFrom: string[] = []
      const scope = isGlobal ? 'global' : 'project'
      const baseDir = isGlobal ? homedir() : getWorkingDirectory()

      for (const agentId of pkg.agents) {
        const placementPath = getSkillPlacementPath(agentId as AgentId, shortName, scope)
        if (!placementPath) continue

        const fullPath = isGlobal ? expandTilde(placementPath) : join(root, placementPath)

        // Validate path stays within expected boundaries before deletion
        assertPathWithin(fullPath, baseDir)

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
