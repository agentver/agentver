import { existsSync, lstatSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import type { RemoveResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { reportRemoval } from '../registry/reporter.js'
import {
  getCanonicalSkillPath,
  isSymlinkedInstall,
  removeAgentSymlinks,
  removeCanonicalDirectory,
} from '../storage/canonical'
import { readLockfile, writeLockfile } from '../storage/lockfile'
import { readManifest, writeManifest } from '../storage/manifest'

export function registerRemoveCommand(program: Command): void {
  program
    .command('remove <name>')
    .alias('uninstall')
    .description('Remove an installed package')
    .option('--dry-run', 'Show what would be removed without making changes')
    .option('--global', 'Remove from user level (~/.agents/skills/) instead of project level')
    .action(async (name: string, options: { dryRun?: boolean; global?: boolean }) => {
      const jsonMode = isJSONMode()
      const scope = options.global ? 'global' : 'project'
      const projectRoot = process.cwd()
      const manifest = readManifest(projectRoot, scope)

      const shortName = name.split('/').pop()!
      const manifestKey =
        name in manifest.packages ? name : shortName in manifest.packages ? shortName : null

      if (!manifestKey) {
        if (jsonMode) {
          outputError('NOT_FOUND', `Package "${name}" is not installed.`)
          process.exit(1)
        }
        console.error(chalk.red(`Package "${name}" is not installed.`))
        process.exit(1)
      }

      const pkg = manifest.packages[manifestKey]!
      const hasCanonical = isSymlinkedInstall(projectRoot, shortName, scope)

      const removedPaths: string[] = []

      if (hasCanonical) {
        const canonicalPath = getCanonicalSkillPath(projectRoot, shortName, scope)
        removedPaths.push(canonicalPath)
        for (const agentId of pkg.agents) {
          const placementPath = getSkillPlacementPath(agentId as AgentId, shortName, scope)
          if (placementPath) {
            removedPaths.push(join(projectRoot, placementPath))
          }
        }
      } else {
        for (const agentId of pkg.agents) {
          const placementPath = getSkillPlacementPath(agentId as AgentId, shortName, scope)
          if (!placementPath) continue
          const fullPath = join(projectRoot, placementPath)
          if (existsSync(fullPath)) {
            removedPaths.push(fullPath)
          }
        }
      }

      if (options.dryRun) {
        if (jsonMode) {
          outputSuccess<RemoveResult>({
            name,
            removed: false,
            paths: removedPaths,
          })
          return
        }

        console.log(`${chalk.yellow('[dry-run]')} Would remove ${chalk.green(name)}`)

        if (hasCanonical) {
          const canonicalPath = getCanonicalSkillPath(projectRoot, shortName, scope)
          console.log(chalk.dim('  Canonical path to remove:'))
          console.log(chalk.dim(`    ${canonicalPath}`))
          console.log(chalk.dim('  Agent symlinks to remove:'))
          for (const agentId of pkg.agents) {
            const placementPath = getSkillPlacementPath(agentId as AgentId, shortName, scope)
            if (placementPath) {
              console.log(chalk.dim(`    ${join(projectRoot, placementPath)}`))
            }
          }
        } else {
          const pathsToRemove = removedPaths.filter((p) => existsSync(p))
          if (pathsToRemove.length > 0) {
            console.log(chalk.dim('  Paths to remove:'))
            for (const p of pathsToRemove) {
              console.log(chalk.dim(`    ${p}`))
            }
          }
        }

        console.log(chalk.dim('  Would update manifest and lockfile'))
        return
      }

      const spinner = createSpinner(`Removing ${name}...`).start()

      if (hasCanonical) {
        removeAgentSymlinks(projectRoot, shortName, pkg.agents, scope)
        removeCanonicalDirectory(projectRoot, shortName, scope)
      } else {
        for (const agentId of pkg.agents) {
          const placementPath = getSkillPlacementPath(agentId as AgentId, shortName, scope)
          if (!placementPath) continue

          const fullPath = join(projectRoot, placementPath)
          if (existsSync(fullPath) || isSymlinkPath(fullPath)) {
            rmSync(fullPath, { recursive: true, force: true })
          }
        }
      }

      delete manifest.packages[manifestKey]
      writeManifest(projectRoot, manifest, scope)

      const lockfile = readLockfile(projectRoot, scope)
      delete lockfile.packages[manifestKey]
      writeLockfile(projectRoot, lockfile, scope)

      reportRemoval(name)

      if (jsonMode) {
        outputSuccess<RemoveResult>({
          name,
          removed: true,
          paths: removedPaths,
        })
      } else {
        const scopeLabel = scope === 'global' ? 'user' : 'project'
        spinner.succeed(`Removed ${chalk.green(name)} ${chalk.dim(`(${scopeLabel})`)}`)
      }
    })
}

function isSymlinkPath(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink()
  } catch {
    return false
  }
}
