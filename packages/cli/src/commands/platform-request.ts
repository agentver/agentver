import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type AgentId,
  getAgentPlacementPath,
  getCommandPlacementPath,
  getSkillPlacementPath,
} from '@agentver/agent-definitions'
import { readFilesFromDirectory } from '../git/fetcher.js'
import { resolveReadPath } from '../storage/canonical.js'
import { resolvePlacementPath, type Scope } from '../utils/paths.js'

type ReadInstalledPackageFilesOptions = {
  scope?: Scope
  packageType?: string
  entryFile?: string
}

export async function readInstalledPackageFiles(
  projectRoot: string,
  packageName: string,
  agents: string[],
  options: Scope | ReadInstalledPackageFilesOptions = 'project'
): Promise<Array<{ path: string; content: string }>> {
  const resolvedOptions = typeof options === 'string' ? { scope: options } : options
  const scope = resolvedOptions.scope ?? 'project'

  if (resolvedOptions.packageType === 'AGENT' || resolvedOptions.packageType === 'COMMAND') {
    const getPlacementPath =
      resolvedOptions.packageType === 'AGENT' ? getAgentPlacementPath : getCommandPlacementPath
    const shortName = packageName.split('/').pop() ?? packageName
    const fileName = resolvedOptions.entryFile ?? `${shortName}.md`

    for (const agentId of agents) {
      const placementPath = getPlacementPath(agentId as AgentId, fileName, scope)
      if (!placementPath) {
        continue
      }

      const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
      if (!fullPath || !existsSync(fullPath)) {
        continue
      }

      return [{ path: fileName, content: readFileSync(fullPath, 'utf-8') }]
    }

    return []
  }

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
