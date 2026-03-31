import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import { readFilesFromDirectory } from '../git/fetcher.js'
import { resolveReadPath } from '../storage/canonical.js'
import type { Scope } from '../utils/paths.js'

export async function readInstalledPackageFiles(
  projectRoot: string,
  packageName: string,
  agents: string[],
  scope: Scope = 'project'
): Promise<Array<{ path: string; content: string }>> {
  try {
    const readPath = resolveReadPath(projectRoot, packageName, agents, scope)
    if (readPath) {
      const files = await readFilesFromDirectory(readPath)
      return files.map((file) => ({ path: file.path, content: file.content }))
    }
  } catch {
    // Fall through to the legacy placement lookup when canonical resolution
    // is unavailable.
  }

  for (const agentId of agents) {
    const placementPath = getSkillPlacementPath(agentId as AgentId, packageName, scope)
    if (!placementPath) {
      continue
    }

    const fullPath = join(projectRoot, placementPath)
    if (!existsSync(fullPath)) {
      continue
    }

    const files = await readFilesFromDirectory(fullPath)
    return files.map((file) => ({ path: file.path, content: file.content }))
  }

  return []
}
