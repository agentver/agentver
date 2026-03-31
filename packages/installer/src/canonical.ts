import { existsSync, lstatSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  type AgentId,
  getAgentPlacementPath,
  getCommandPlacementPath,
  getSkillPlacementPath,
} from '@agentver/agent-definitions'
import type { CanonicalCategory, InstallScope, PackageType } from './types'

const CANONICAL_CATEGORY_DIRS: Record<CanonicalCategory, string> = {
  skills: '.agents/skills',
  agents: '.agents/agents',
  commands: '.agents/commands',
}

/**
 * Maps a PackageType to its CanonicalCategory for storage placement.
 */
export function resolveCanonicalCategory(packageType: PackageType): CanonicalCategory {
  switch (packageType) {
    case 'AGENT':
      return 'agents'
    case 'COMMAND':
      return 'commands'
    case 'SKILL':
    case 'AGENT_CONFIG':
    case 'PLUGIN':
    case 'SCRIPT':
    case 'PROMPT':
    case 'BUNDLE':
      return 'skills'
  }
}

/**
 * Returns the root directory for a given scope.
 */
function getScopeRoot(projectRoot: string, scope: InstallScope): string {
  return scope === 'global' ? homedir() : projectRoot
}

/**
 * Validates a package name against path traversal attacks.
 */
function validateName(name: string, label: string): void {
  if (name.includes('..') || name.startsWith('/')) {
    throw new Error(`Invalid ${label}: path traversal detected in "${name}"`)
  }
}

/**
 * Returns the canonical directory path where skill files are stored once.
 * For project scope: `<projectRoot>/.agents/skills/<name>/`
 * For global scope: `~/.agents/skills/<name>/`
 */
export function getCanonicalSkillPath(
  projectRoot: string,
  name: string,
  scope: InstallScope
): string {
  validateName(name, 'skill name')
  const root = getScopeRoot(projectRoot, scope)
  return join(root, CANONICAL_CATEGORY_DIRS.skills, name)
}

/**
 * Returns the canonical path for a single file (agent or command).
 * For project scope: `<projectRoot>/.agents/<category>/<name>.md`
 * For global scope: `~/.agents/<category>/<name>.md`
 */
export function getCanonicalFilePath(
  projectRoot: string,
  name: string,
  category: CanonicalCategory,
  scope: InstallScope
): string {
  validateName(name, 'name')
  const root = getScopeRoot(projectRoot, scope)
  return join(root, CANONICAL_CATEGORY_DIRS[category], `${name}.md`)
}

/**
 * Resolves a placement path to a full absolute path with traversal protection.
 *
 * For global scope: expands a leading ~ to the user's home directory.
 * For project scope: joins with projectRoot.
 * Returns null if the resolved path escapes the expected root.
 */
export function resolvePlacementPath(
  placementPath: string,
  projectRoot: string,
  scope: InstallScope
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

/**
 * Resolves the agent placement path for a given category.
 * Returns null if the agent does not support placements for this category.
 */
export function getPlacementPathForCategory(
  agentId: string,
  name: string,
  category: CanonicalCategory,
  scope: InstallScope
): string | null {
  const agentScope = scope === 'global' ? 'global' : 'project'

  switch (category) {
    case 'skills':
      return getSkillPlacementPath(agentId as AgentId, name, agentScope)
    case 'agents':
      return getAgentPlacementPath(agentId as AgentId, `${name}.md`, agentScope)
    case 'commands':
      return getCommandPlacementPath(agentId as AgentId, `${name}.md`, agentScope)
  }
}

/**
 * Checks whether a package is using the canonical install pattern.
 * Returns true if the canonical directory/file exists for this package.
 */
export function isCanonicalInstall(
  projectRoot: string,
  name: string,
  scope: InstallScope = 'project',
  category: CanonicalCategory = 'skills'
): boolean {
  if (category === 'skills') {
    const canonicalPath = getCanonicalSkillPath(projectRoot, name, scope)
    return existsSync(canonicalPath) && lstatSync(canonicalPath).isDirectory()
  }

  const canonicalPath = getCanonicalFilePath(projectRoot, name, category, scope)
  return existsSync(canonicalPath) && lstatSync(canonicalPath).isFile()
}

/**
 * Resolves the best path to read files from for a given package.
 * Returns the canonical path if it exists, otherwise falls back to
 * the first agent-specific path that exists (backwards compatibility).
 */
export function resolveReadPath(
  projectRoot: string,
  packageName: string,
  agents: string[],
  scope: InstallScope = 'project',
  category: CanonicalCategory = 'skills'
): string | null {
  validateName(packageName, 'package name')

  const root = getScopeRoot(projectRoot, scope)
  const categoryDir = CANONICAL_CATEGORY_DIRS[category]
  const resolvedPath = resolve(root, categoryDir, packageName)
  if (!resolvedPath.startsWith(`${resolve(root)}/`) && resolvedPath !== resolve(root)) {
    throw new Error('Invalid package name: resolved path escapes project root')
  }

  if (category === 'skills') {
    const canonicalPath = getCanonicalSkillPath(projectRoot, packageName, scope)
    if (existsSync(canonicalPath) && lstatSync(canonicalPath).isDirectory()) {
      return canonicalPath
    }

    for (const agentId of agents) {
      const placementPath = getSkillPlacementPath(agentId as AgentId, packageName, scope)
      if (!placementPath) continue

      const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
      if (!fullPath) continue

      if (existsSync(fullPath)) {
        if (isSymlink(fullPath)) {
          const target = readlinkSync(fullPath)
          const resolvedTarget = join(dirname(fullPath), target)
          if (existsSync(resolvedTarget)) {
            return resolvedTarget
          }
        }
        return fullPath
      }
    }
  } else {
    const canonicalPath = getCanonicalFilePath(projectRoot, packageName, category, scope)
    if (existsSync(canonicalPath) && lstatSync(canonicalPath).isFile()) {
      return canonicalPath
    }

    for (const agentId of agents) {
      const placementPath = getPlacementPathForCategory(agentId, packageName, category, scope)
      if (!placementPath) continue

      const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
      if (!fullPath) continue

      if (existsSync(fullPath)) {
        if (isSymlink(fullPath)) {
          const target = readlinkSync(fullPath)
          const resolvedTarget = join(dirname(fullPath), target)
          if (existsSync(resolvedTarget)) {
            return resolvedTarget
          }
        }
        return fullPath
      }
    }
  }

  return null
}

/**
 * Checks if a path is a symlink (even if broken).
 */
export function isSymlink(filePath: string): boolean {
  try {
    const stats = lstatSync(filePath)
    return stats.isSymbolicLink()
  } catch {
    return false
  }
}
