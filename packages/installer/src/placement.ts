import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, relative } from 'node:path'
import { getPlacementPathForCategory, isSymlink, resolvePlacementPath } from './canonical'
import type {
  CanonicalCategory,
  InstallScope,
  LinkMode,
  PlacementOperation,
  PlacementResult,
} from './types'

type PlacementOptions = {
  allowFallback: boolean
}

/**
 * Creates agent placements (symlinks, copies, or junctions) from the canonical
 * path to each agent's placement directory.
 *
 * Returns a PlacementResult per operation, regardless of success or failure.
 */
export function createAgentPlacements(
  canonicalPath: string,
  placements: PlacementOperation[],
  projectRoot: string,
  scope: InstallScope,
  options: PlacementOptions
): PlacementResult[] {
  const results: PlacementResult[] = []

  for (const placement of placements) {
    const result = createSinglePlacement(canonicalPath, placement, projectRoot, scope, options)
    results.push(result)
  }

  return results
}

/**
 * Removes agent placements for a given package and cleans up empty directories.
 */
export function removeAgentPlacements(
  projectRoot: string,
  name: string,
  agents: string[],
  scope: InstallScope,
  category: CanonicalCategory
): void {
  for (const agentId of agents) {
    const placementPath = getPlacementPathForCategory(agentId, name, category, scope)
    if (!placementPath) continue

    const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
    if (!fullPath) continue

    if (existsSync(fullPath) || isSymlink(fullPath)) {
      rmSync(fullPath, { recursive: true, force: true })
    }

    const stopAt = scope === 'global' ? homedir() : projectRoot
    cleanupEmptyParents(dirname(fullPath), stopAt)
  }
}

/**
 * Creates a relative symlink from linkPath pointing to target.
 * The symlink path is relative so the project remains portable.
 */
export function createRelativeSymlink(target: string, linkPath: string): void {
  const parentDir = dirname(linkPath)
  const relativeTarget = relative(parentDir, target)

  mkdirSync(parentDir, { recursive: true })
  symlinkSync(relativeTarget, linkPath)
}

/**
 * Recursively copies source to destination.
 */
export function createCopy(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true, dereference: true })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function createSinglePlacement(
  canonicalPath: string,
  placement: PlacementOperation,
  _projectRoot: string,
  _scope: InstallScope,
  options: PlacementOptions
): PlacementResult {
  const { agentId, destinationPath, linkMode } = placement
  const preferredMode = linkMode.mode

  // Remove existing symlinks managed by Agentver before placement
  if (isSymlink(destinationPath)) {
    rmSync(destinationPath, { recursive: true, force: true })
  }

  // Ensure parent directory exists
  mkdirSync(dirname(destinationPath), { recursive: true })

  // Attempt preferred link mode
  const primaryResult = attemptLink(canonicalPath, destinationPath, preferredMode)

  if (primaryResult.success) {
    return {
      agentId,
      destinationPath,
      actualLinkMode: preferredMode,
      fallbackUsed: false,
      success: true,
    }
  }

  // Attempt fallback to copy if allowed
  if (options.allowFallback && preferredMode !== 'copy') {
    const fallbackResult = attemptLink(canonicalPath, destinationPath, 'copy')

    if (fallbackResult.success) {
      return {
        agentId,
        destinationPath,
        actualLinkMode: 'copy',
        fallbackUsed: true,
        fallbackReason: primaryResult.error,
        success: true,
      }
    }

    return {
      agentId,
      destinationPath,
      actualLinkMode: 'copy',
      fallbackUsed: true,
      fallbackReason: primaryResult.error,
      success: false,
      error: fallbackResult.error,
    }
  }

  return {
    agentId,
    destinationPath,
    actualLinkMode: preferredMode,
    fallbackUsed: false,
    success: false,
    error: primaryResult.error,
  }
}

function attemptLink(
  canonicalPath: string,
  destinationPath: string,
  mode: LinkMode
): { success: boolean; error?: string } {
  try {
    switch (mode) {
      case 'symlink': {
        createRelativeSymlink(canonicalPath, destinationPath)
        return { success: true }
      }
      case 'copy': {
        createCopy(canonicalPath, destinationPath)
        return { success: true }
      }
      case 'junction': {
        // Junctions require 'junction' type on Windows, behave like symlinks on POSIX
        mkdirSync(dirname(destinationPath), { recursive: true })
        symlinkSync(canonicalPath, destinationPath, 'junction')
        return { success: true }
      }
      default: {
        const _exhaustive: never = mode
        return { success: false, error: `Unsupported link mode: ${String(_exhaustive)}` }
      }
    }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

/**
 * Removes empty parent directories up to (but not including) the stop directory.
 */
function cleanupEmptyParents(dirPath: string, stopAt: string): void {
  let current = dirPath

  while (current !== stopAt && current.startsWith(`${stopAt}/`)) {
    try {
      const entries = readdirSync(current)
      if (entries.length === 0) {
        rmSync(current, { recursive: true, force: true })
        current = dirname(current)
      } else {
        break
      }
    } catch {
      break
    }
  }
}
