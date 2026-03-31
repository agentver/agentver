/**
 * Dependency and conflict enforcement for skill installation and removal.
 *
 * Reads `dependsOn` and `conflictsWith` from SKILL.md frontmatter and
 * validates them against the current manifest state.
 */

import type { ManifestV2 } from '@agentver/shared'
import { AgentverError, parseSkillFrontmatter } from '@agentver/shared'
import type { FetchedFile } from './git/types'
import { getDisplayName, resolvePackageQuery } from './storage/package-identity'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DependencyCheckResult = {
  dependsOn: string[]
  conflictsWith: string[]
}

export type ReverseDependency = {
  /** The package that depends on the one being removed */
  name: string
  /** The dependsOn list from that package's manifest entry */
  dependsOn: string[]
}

// ---------------------------------------------------------------------------
// Extract dependency metadata from fetched files
// ---------------------------------------------------------------------------

/**
 * Parse the SKILL.md from fetched files and extract `dependsOn` / `conflictsWith`.
 * Returns empty arrays when no SKILL.md is present or the fields are absent.
 */
export function extractDependencyMetadata(files: FetchedFile[]): DependencyCheckResult {
  const skillFile = files.find((f) => f.path === 'SKILL.md')
  if (!skillFile) {
    return { dependsOn: [], conflictsWith: [] }
  }

  try {
    const { frontmatter } = parseSkillFrontmatter(skillFile.content)
    return {
      dependsOn: frontmatter.dependsOn ?? [],
      conflictsWith: frontmatter.conflictsWith ?? [],
    }
  } catch {
    return { dependsOn: [], conflictsWith: [] }
  }
}

// ---------------------------------------------------------------------------
// Install-time enforcement
// ---------------------------------------------------------------------------

/**
 * Check that all `dependsOn` packages are already installed.
 * Throws `DEPENDENCY_MISSING` if any are absent.
 */
export function enforceDependencies(
  dependsOn: string[],
  manifest: ManifestV2,
  skillName: string
): void {
  if (dependsOn.length === 0) return

  const missing = dependsOn.filter((dep) => !resolvePackageQuery(manifest.packages, dep).ok)

  if (missing.length > 0) {
    const list = missing.map((d) => `  - ${d}`).join('\n')
    throw new AgentverError(
      'DEPENDENCY_MISSING',
      `Cannot install "${skillName}" — the following dependencies are not installed:\n${list}\n\nInstall them first with: agentver install <source>`
    )
  }
}

/**
 * Check that no `conflictsWith` packages are currently installed.
 * Throws `CONFLICT_DETECTED` if any conflicts are found.
 */
export function enforceConflicts(
  conflictsWith: string[],
  manifest: ManifestV2,
  skillName: string
): void {
  if (conflictsWith.length === 0) return

  const conflicts = conflictsWith.filter(
    (conflict) => resolvePackageQuery(manifest.packages, conflict).ok
  )

  if (conflicts.length > 0) {
    const list = conflicts.map((c) => `  - ${c}`).join('\n')
    throw new AgentverError(
      'CONFLICT_DETECTED',
      `Cannot install "${skillName}" — it conflicts with the following installed packages:\n${list}\n\nRemove the conflicting packages first with: agentver remove <name>`
    )
  }
}

// ---------------------------------------------------------------------------
// Removal-time enforcement
// ---------------------------------------------------------------------------

/**
 * Find all installed packages that list `targetName` in their `dependsOn`.
 * Returns the list of dependents so the caller can warn or block.
 */
export function findReverseDependencies(
  targetName: string,
  manifest: ManifestV2
): ReverseDependency[] {
  const dependents: ReverseDependency[] = []
  const targetLookup = resolvePackageQuery(manifest.packages, targetName)
  const targetDisplayName = targetLookup.ok ? targetLookup.displayName : targetName

  for (const [packageKey, pkg] of Object.entries(manifest.packages)) {
    const displayName = getDisplayName(packageKey, pkg)
    if (displayName === targetDisplayName || packageKey === targetName) continue
    const deps = pkg.dependsOn ?? []
    if (deps.includes(targetDisplayName) || deps.includes(targetName)) {
      dependents.push({ name: displayName, dependsOn: deps })
    }
  }

  return dependents
}
