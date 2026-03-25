import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import { createLogger } from '@agentver/shared'
import chalk from 'chalk'
import { getLogLevel } from '../output.js'
import { resolvePlacementPath, type Scope } from '../utils/paths'

const logger = createLogger('canonical', getLogLevel())

const CANONICAL_DIR = '.agents/skills'

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
 * Checks whether a package is using the canonical symlinked install pattern.
 * Returns true if the canonical directory exists for this skill.
 */
export function isSymlinkedInstall(
  projectRoot: string,
  name: string,
  scope: Scope = 'project'
): boolean {
  const canonicalPath = getCanonicalSkillPath(projectRoot, name, scope)
  return existsSync(canonicalPath) && lstatSync(canonicalPath).isDirectory()
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

    // If this path already exists (file, directory, or symlink), remove it first
    if (existsSync(agentSkillPath) || isSymlink(agentSkillPath)) {
      rmSync(agentSkillPath, { recursive: true, force: true })
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

/**
 * Resolves the best path to read files from for a given package.
 * Returns the canonical path if it exists, otherwise falls back to
 * the first agent-specific path that exists (backwards compatibility).
 */
export function resolveReadPath(
  projectRoot: string,
  packageName: string,
  agents: string[],
  scope: Scope = 'project'
): string | null {
  if (packageName.includes('..') || packageName.startsWith('/')) {
    throw new Error(`Invalid package name: path traversal detected in "${packageName}"`)
  }

  const root = scope === 'global' ? homedir() : projectRoot
  const resolvedPath = resolve(root, CANONICAL_DIR, packageName)
  if (!resolvedPath.startsWith(resolve(root) + '/') && resolvedPath !== resolve(root)) {
    throw new Error(`Invalid package name: resolved path escapes project root`)
  }

  // Try canonical path first
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

  while (current !== stopAt && current.startsWith(stopAt + '/')) {
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
