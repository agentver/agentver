import { homedir } from 'node:os'
import { join } from 'node:path'

export type Scope = 'project' | 'global'

/**
 * Resolves a skill placement path to a full absolute path.
 *
 * For global scope: expands a leading ~ to the user's home directory.
 *   Returns null if the path does not start with ~ (unsafe) or resolves
 *   outside the home directory (path traversal guard).
 * For project scope: joins with projectRoot. Returns null if the resolved
 *   path escapes projectRoot (path traversal guard).
 */
export function resolvePlacementPath(
  placementPath: string,
  projectRoot: string,
  scope: Scope
): string | null {
  if (scope === 'global') {
    const home = homedir()
    if (!placementPath.startsWith('~')) return null
    const resolved = join(home, placementPath.slice(1))
    if (!resolved.startsWith(`${home}/`)) return null
    return resolved
  }
  const resolved = join(projectRoot, placementPath)
  if (!resolved.startsWith(`${projectRoot}/`) && resolved !== projectRoot) return null
  return resolved
}
