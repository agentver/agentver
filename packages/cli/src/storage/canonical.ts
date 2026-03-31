import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import { AgentverError } from '@agentver/shared'
import chalk from 'chalk'
import { resolvePlacementPath, type Scope } from '../utils/paths'
import { createCliLogger } from '../utils.js'

const logger = createCliLogger('canonical')

const CANONICAL_DIR = '.agents/skills'

export type CanonicalCategory = 'skills' | 'agents' | 'commands'

export type SkillPlacementConflict = {
  agentId: string
  path: string
  kind: 'directory' | 'file'
}

const CANONICAL_CATEGORY_DIRS: Record<CanonicalCategory, string> = {
  skills: '.agents/skills',
  agents: '.agents/agents',
  commands: '.agents/commands',
}

/**
 * Returns the canonical path where skill files are stored once.
 * For project scope: `<projectRoot>/.agents/skills/<name>`
 * For global scope: `~/.agents/skills/<name>`
 */
export function getCanonicalSkillPath(projectRoot: string, name: string, scope: Scope): string {
  if (name.includes('..') || name.startsWith('/')) {
    throw new Error(`Invalid skill name: path traversal detected in "${name}"`)
  }

  if (scope === 'global') {
    const home = homedir()
    return join(home, CANONICAL_DIR, name)
  }
  return join(projectRoot, CANONICAL_DIR, name)
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
  scope: Scope
): string {
  if (name.includes('..') || name.startsWith('/')) {
    throw new Error(`Invalid name: path traversal detected in "${name}"`)
  }

  const root = scope === 'global' ? homedir() : projectRoot
  return join(root, CANONICAL_CATEGORY_DIRS[category], `${name}.md`)
}

/**
 * Derives a file-level placement path for a given agent by replacing the
 * trailing `skills` segment in its skill path with the target category.
 * Returns null if the agent is unknown or its skill path doesn't end with `skills`.
 */
export function getFilePlacementPath(
  agentId: AgentId,
  name: string,
  category: CanonicalCategory,
  scope: Scope
): string | null {
  const baseSkillPath = getSkillPlacementPath(agentId, '', scope)
  if (!baseSkillPath) return null

  // Strip trailing slash from the base path if present
  const normalised = baseSkillPath.replace(/\/+$/, '')

  // The base path must end with /skills or be exactly 'skills'
  if (!normalised.endsWith('/skills') && normalised !== 'skills') {
    logger.warn(
      `Agent ${agentId} skill path "${baseSkillPath}" does not end with /skills — cannot derive ${category} path`
    )
    return null
  }

  const categoryPath = normalised.replace(/skills$/, category)
  return join(categoryPath, `${name}.md`)
}

/**
 * Checks whether a package is using the canonical symlinked install pattern.
 * Returns true if the canonical directory exists for this skill,
 * or the canonical file exists for agents/commands.
 */
export function isSymlinkedInstall(
  projectRoot: string,
  name: string,
  scope: Scope = 'project',
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
 * Creates symlinks from each agent's skill directory to the canonical path.
 * Uses relative symlinks so the project remains portable.
 * Falls back to a warning if symlink creation fails (e.g. Windows without elevated permissions).
 */
export function createAgentSymlinks(
  projectRoot: string,
  name: string,
  agents: string[],
  scope: Scope
): void {
  const canonicalPath = getCanonicalSkillPath(projectRoot, name, scope)

  for (const agentId of agents) {
    const placementPath = getSkillPlacementPath(agentId as AgentId, name, scope)
    if (!placementPath) continue

    const agentSkillPath = resolvePlacementPath(placementPath, projectRoot, scope)
    if (!agentSkillPath) continue

    if (isSymlink(agentSkillPath)) {
      rmSync(agentSkillPath, { recursive: true, force: true })
    } else if (existsSync(agentSkillPath)) {
      const stats = lstatSync(agentSkillPath)
      const kind = stats.isDirectory() ? 'directory' : 'file'
      throw new AgentverError(
        'CONFLICT_DETECTED',
        `Refusing to replace existing ${kind} at ${agentSkillPath}. Move it first or re-run install with confirmation so Agentver can back it up.`
      )
    }

    // Ensure the parent directory exists
    const parentDir = dirname(agentSkillPath)
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }

    // Compute relative symlink target
    const relativeTarget = relative(parentDir, canonicalPath)

    try {
      symlinkSync(relativeTarget, agentSkillPath)
    } catch (error) {
      // Symlink failed — likely Windows without elevated permissions
      // Log a warning but don't fail the install; the canonical directory
      // still has the files so the install isn't broken
      logger.warn(`Could not create symlink at ${agentSkillPath}: ${String(error)}`)
      console.log(
        chalk.yellow('  Warning:') +
          ` Could not create symlink for ${agentId}. ` +
          chalk.dim('Files are available at the canonical path.')
      )
    }
  }
}

/**
 * Creates file-level symlinks from each agent's placement directory to the canonical file.
 * Uses relative symlinks so the project remains portable.
 */
export function createFileSymlinks(
  projectRoot: string,
  name: string,
  category: CanonicalCategory,
  agents: string[],
  scope: Scope
): void {
  const canonicalPath = getCanonicalFilePath(projectRoot, name, category, scope)

  for (const agentId of agents) {
    const placementPath = getFilePlacementPath(agentId as AgentId, name, category, scope)
    if (!placementPath) continue

    const agentFilePath = resolvePlacementPath(placementPath, projectRoot, scope)
    if (!agentFilePath) continue

    if (isSymlink(agentFilePath)) {
      rmSync(agentFilePath, { force: true })
    } else if (existsSync(agentFilePath)) {
      throw new AgentverError(
        'CONFLICT_DETECTED',
        `Refusing to replace existing file at ${agentFilePath}. Move it first before creating a canonical symlink.`
      )
    }

    // Ensure the parent directory exists
    const parentDir = dirname(agentFilePath)
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }

    // Compute relative symlink target
    const relativeTarget = relative(parentDir, canonicalPath)

    try {
      symlinkSync(relativeTarget, agentFilePath)
    } catch (error) {
      logger.warn(`Could not create symlink at ${agentFilePath}: ${String(error)}`)
      console.log(
        chalk.yellow('  Warning:') +
          ` Could not create file symlink for ${agentId}. ` +
          chalk.dim('File is available at the canonical path.')
      )
    }
  }
}

/**
 * Removes symlinks from each agent's skill directory for a given package.
 * Also cleans up empty parent directories.
 */
export function removeAgentSymlinks(
  projectRoot: string,
  name: string,
  agents: string[],
  scope: Scope
): void {
  for (const agentId of agents) {
    const placementPath = getSkillPlacementPath(agentId as AgentId, name, scope)
    if (!placementPath) continue

    const agentSkillPath = resolvePlacementPath(placementPath, projectRoot, scope)
    if (!agentSkillPath) continue

    if (existsSync(agentSkillPath) || isSymlink(agentSkillPath)) {
      rmSync(agentSkillPath, { recursive: true, force: true })
    }

    // Clean up empty parent directories
    const stopAt = scope === 'global' ? homedir() : projectRoot
    cleanupEmptyParents(dirname(agentSkillPath), stopAt)
  }
}

/**
 * Removes file-level symlinks from each agent's placement directory for a given package.
 * Also cleans up empty parent directories.
 */
export function removeFileSymlinks(
  projectRoot: string,
  name: string,
  category: CanonicalCategory,
  agents: string[],
  scope: Scope
): void {
  for (const agentId of agents) {
    const placementPath = getFilePlacementPath(agentId as AgentId, name, category, scope)
    if (!placementPath) continue

    const agentFilePath = resolvePlacementPath(placementPath, projectRoot, scope)
    if (!agentFilePath) continue

    if (existsSync(agentFilePath) || isSymlink(agentFilePath)) {
      rmSync(agentFilePath, { force: true })
    }

    // Clean up empty parent directories
    const stopAt = scope === 'global' ? homedir() : projectRoot
    cleanupEmptyParents(dirname(agentFilePath), stopAt)
  }
}

/**
 * Removes the canonical file for an agent or command package.
 */
export function removeCanonicalFile(
  projectRoot: string,
  name: string,
  category: CanonicalCategory,
  scope: Scope
): void {
  const canonicalPath = getCanonicalFilePath(projectRoot, name, category, scope)

  if (existsSync(canonicalPath)) {
    unlinkSync(canonicalPath)
  }

  // Clean up empty parent directories
  const stopAt = scope === 'global' ? homedir() : projectRoot
  cleanupEmptyParents(dirname(canonicalPath), stopAt)
}

/**
 * Removes the canonical skill directory.
 */
export function removeCanonicalDirectory(projectRoot: string, name: string, scope: Scope): void {
  const canonicalPath = getCanonicalSkillPath(projectRoot, name, scope)

  if (existsSync(canonicalPath)) {
    rmSync(canonicalPath, { recursive: true, force: true })
  }

  // Clean up empty parent directories
  const stopAt = scope === 'global' ? homedir() : projectRoot
  cleanupEmptyParents(dirname(canonicalPath), stopAt)
}

export function findAgentSkillPlacementConflicts(
  projectRoot: string,
  name: string,
  agents: string[],
  scope: Scope
): SkillPlacementConflict[] {
  const conflicts: SkillPlacementConflict[] = []

  for (const agentId of agents) {
    const placementPath = getSkillPlacementPath(agentId as AgentId, name, scope)
    if (!placementPath) continue

    const agentSkillPath = resolvePlacementPath(placementPath, projectRoot, scope)
    if (!agentSkillPath) continue

    if (!existsSync(agentSkillPath) || isSymlink(agentSkillPath)) {
      continue
    }

    const stats = lstatSync(agentSkillPath)
    conflicts.push({
      agentId,
      path: agentSkillPath,
      kind: stats.isDirectory() ? 'directory' : 'file',
    })
  }

  return conflicts
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
  scope: Scope = 'project',
  category: CanonicalCategory = 'skills'
): string | null {
  if (packageName.includes('..') || packageName.startsWith('/')) {
    throw new Error(`Invalid package name: path traversal detected in "${packageName}"`)
  }

  const root = scope === 'global' ? homedir() : projectRoot
  const categoryDir = CANONICAL_CATEGORY_DIRS[category]
  const resolvedPath = resolve(root, categoryDir, packageName)
  if (!resolvedPath.startsWith(`${resolve(root)}/`) && resolvedPath !== resolve(root)) {
    throw new Error(`Invalid package name: resolved path escapes project root`)
  }

  if (category === 'skills') {
    // Try canonical directory path first
    const canonicalPath = getCanonicalSkillPath(projectRoot, packageName, scope)
    if (existsSync(canonicalPath) && lstatSync(canonicalPath).isDirectory()) {
      return canonicalPath
    }

    // Fall back to agent-specific paths (pre-canonical installs)
    for (const agentId of agents) {
      const placementPath = getSkillPlacementPath(agentId as AgentId, packageName, scope)
      if (!placementPath) continue

      const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
      if (!fullPath) continue

      if (existsSync(fullPath)) {
        // If it's a symlink, resolve to the canonical directory
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
    // Try canonical file path first
    const canonicalPath = getCanonicalFilePath(projectRoot, packageName, category, scope)
    if (existsSync(canonicalPath) && lstatSync(canonicalPath).isFile()) {
      return canonicalPath
    }

    // Fall back to agent-specific file paths
    for (const agentId of agents) {
      const placementPath = getFilePlacementPath(agentId as AgentId, packageName, category, scope)
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
