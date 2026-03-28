import { existsSync, rmSync } from 'node:fs'
import {
  type AgentId,
  getAgentPlacementPath,
  getCommandPlacementPath,
  getSkillPlacementPath,
} from '@agentver/agent-definitions'
import type { RemoveResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import prompts from 'prompts'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { reportRemoval } from '../registry/reporter.js'
import {
  getCanonicalSkillPath,
  isSymlink,
  isSymlinkedInstall,
  removeAgentSymlinks,
  removeCanonicalDirectory,
} from '../storage/canonical'
import { readLockfile, writeLockfile } from '../storage/lockfile'
import { readManifest, writeManifest } from '../storage/manifest'
import { resolvePlacementPath, type Scope } from '../utils/paths'

export function registerRemoveCommand(program: Command): void {
  program
    .command('remove <name>')
    .alias('uninstall')
    .description('Remove an installed package')
    .option('--dry-run', 'Show what would be removed without making changes')
    .option('--global', 'Remove from user level (~/.agents/skills/) instead of project level')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(
      async (name: string, options: { dryRun?: boolean; global?: boolean; yes?: boolean }) => {
        const jsonMode = isJSONMode()
        const scope: Scope = options.global ? 'global' : 'project'
        const projectRoot = process.cwd()
        const manifest = readManifest(projectRoot, scope)

        const shortName = name.split('/').pop()!
        const manifestKey =
          name in manifest.packages ? name : shortName in manifest.packages ? shortName : null

        if (!manifestKey) {
          const caseMatches = Object.keys(manifest.packages).filter(
            (key) =>
              (key.toLowerCase() === name.toLowerCase() ||
                key.toLowerCase() === shortName.toLowerCase()) &&
              key !== name &&
              key !== shortName
          )

          const otherScope: Scope = scope === 'project' ? 'global' : 'project'
          const otherManifest = readManifest(projectRoot, otherScope)
          const foundInOther = name in otherManifest.packages || shortName in otherManifest.packages

          const hints: string[] = []
          if (caseMatches.length > 0) {
            hints.push(`Did you mean: ${caseMatches.join(', ')}?`)
          }
          if (foundInOther) {
            if (otherScope === 'global') {
              hints.push(`Found in global scope — try: agentver remove ${name} --global`)
            } else {
              hints.push(`Found in project scope — try without --global`)
            }
          }

          if (jsonMode) {
            const msg =
              hints.length > 0
                ? `Package "${name}" is not installed. ${hints.join(' ')}`
                : `Package "${name}" is not installed.`
            outputError('NOT_FOUND', msg)
            process.exit(1)
          }
          console.error(chalk.red(`Package "${name}" is not installed.`))
          for (const hint of hints) {
            console.error(chalk.dim(hint))
          }
          process.exit(1)
        }

        const pkg = manifest.packages[manifestKey]!
        const isSingleFile = pkg.packageType === 'AGENT' || pkg.packageType === 'COMMAND'
        const hasCanonical = !isSingleFile && isSymlinkedInstall(projectRoot, shortName, scope)

        const removedPaths: string[] = []

        if (isSingleFile) {
          const getPlacementPath = pkg.packageType === 'AGENT' ? getAgentPlacementPath : getCommandPlacementPath
          const fileName = `${shortName}.md`
          for (const agentId of pkg.agents) {
            const placementPath = getPlacementPath(agentId as AgentId, fileName, scope)
            if (!placementPath) continue
            const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
            if (!fullPath) continue
            if (existsSync(fullPath)) {
              removedPaths.push(fullPath)
            }
          }
        } else if (hasCanonical) {
          const canonicalPath = getCanonicalSkillPath(projectRoot, shortName, scope)
          removedPaths.push(canonicalPath)
          for (const agentId of pkg.agents) {
            const placementPath = getSkillPlacementPath(agentId as AgentId, shortName, scope)
            if (placementPath) {
              const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
              if (fullPath) removedPaths.push(fullPath)
            }
          }
        } else {
          for (const agentId of pkg.agents) {
            const placementPath = getSkillPlacementPath(agentId as AgentId, shortName, scope)
            if (!placementPath) continue
            const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
            if (!fullPath) continue
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
                const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
                if (fullPath) console.log(chalk.dim(`    ${fullPath}`))
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

        if (!options.yes && !jsonMode) {
          const { confirmed } = await prompts({
            type: 'confirm',
            name: 'confirmed',
            message: `Remove ${chalk.bold(name)} and its agent symlinks?`,
            initial: false,
          })

          if (!confirmed) {
            process.stdout.write(chalk.dim('Cancelled.\n'))
            return
          }
        }

        if (jsonMode && !options.yes) {
          outputError('CONFIRMATION_REQUIRED', 'Use --yes flag to confirm removal in JSON mode.')
          process.exit(1)
        }

        const spinner = createSpinner(`Removing ${name}...`).start()

        if (isSingleFile) {
          for (const filePath of removedPaths) {
            if (existsSync(filePath)) {
              rmSync(filePath, { force: true })
            }
          }
        } else if (hasCanonical) {
          removeAgentSymlinks(projectRoot, shortName, pkg.agents, scope)
          removeCanonicalDirectory(projectRoot, shortName, scope)
        } else {
          for (const agentId of pkg.agents) {
            const placementPath = getSkillPlacementPath(agentId as AgentId, shortName, scope)
            if (!placementPath) continue

            const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
            if (!fullPath) continue
            if (existsSync(fullPath) || isSymlink(fullPath)) {
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
      }
    )
}
