import { existsSync, lstatSync, readlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { getPlacementPathForCategory, isSymlink, resolvePlacementPath } from './canonical'
import type { CanonicalCategory, DetectedConflict, InstallScope } from './types'

/**
 * Detects conflicts at each agent's placement path for a given package.
 *
 * A conflict exists when:
 * - A non-symlink file or directory exists at the placement path.
 * - A symlink exists that points somewhere other than the canonical path.
 *
 * Existing Agentver-managed symlinks (pointing to the canonical path) are
 * NOT conflicts -- they will be silently replaced during placement.
 */
export function detectConflicts(
  projectRoot: string,
  name: string,
  agents: string[],
  scope: InstallScope,
  category: CanonicalCategory,
  canonicalPath: string
): DetectedConflict[] {
  const conflicts: DetectedConflict[] = []

  for (const agentId of agents) {
    const placementPath = getPlacementPathForCategory(agentId, name, category, scope)
    if (!placementPath) continue

    const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
    if (!fullPath) continue

    if (!existsSync(fullPath) && !isSymlink(fullPath)) {
      continue
    }

    // If it is a symlink managed by Agentver, no conflict
    if (isAgentverManagedSymlink(fullPath, canonicalPath)) {
      continue
    }

    const stats = lstatSync(fullPath)
    conflicts.push({
      agentId,
      path: fullPath,
      kind: stats.isDirectory() ? 'directory' : 'file',
    })
  }

  return conflicts
}

/**
 * Checks whether a symlink at the given path points to the expected canonical path.
 * A symlink is "Agentver-managed" when it resolves to the canonical path.
 */
export function isAgentverManagedSymlink(symlinkPath: string, canonicalPath: string): boolean {
  try {
    const stats = lstatSync(symlinkPath)
    if (!stats.isSymbolicLink()) return false

    const target = readlinkSync(symlinkPath)
    const resolvedTarget = resolve(dirname(symlinkPath), target)
    return resolvedTarget === resolve(canonicalPath)
  } catch {
    return false
  }
}
