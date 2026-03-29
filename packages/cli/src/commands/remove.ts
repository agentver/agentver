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

/**
 * Find all manifest entries that belong to a given bundle.
 */
function findBundleConstituents(
  manifest: ReturnType<typeof readManifest>,
  bundleName: string
): string[] {
  return Object.entries(manifest.packages)
    .filter(([, pkg]) => pkg.bundle === bundleName)
    .map(([name]) => name)
}

/**
 * Collect paths that would be removed for a given package.
 */
function collectRemovalPaths(
  projectRoot: string,
  shortName: string,
  pkg: { agents: string[] },
  scope: Scope
): string[] {
  const removedPaths: string[] = []
  const hasCanonical = isSymlinkedInstall(projectRoot, shortName, scope)

  if (hasCanonical) {
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

  return removedPaths
}

/**
 * Remove a single package's files from disk, manifest, and lockfile.
 */
function removePackageFiles(
  projectRoot: string,
  manifestKey: string,
  shortName: string,
  pkg: { agents: string[] },
  scope: Scope,
  manifest: ReturnType<typeof readManifest>,
  lockfile: ReturnType<typeof readLockfile>
): void {
  const hasCanonical = isSymlinkedInstall(projectRoot, shortName, scope)

  if (hasCanonical) {
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
  delete lockfile.packages[manifestKey]
}

/**
 * Collect removal paths for single-file AGENT/COMMAND packages.
 */
function collectSingleFileRemovalPaths(
  projectRoot: string,
  shortName: string,
  pkg: { agents: string[]; packageType?: string; entryFile?: string },
  scope: Scope
): string[] {
  const removedPaths: string[] = []
  const isSingleFile = pkg.packageType === 'AGENT' || pkg.packageType === 'COMMAND'
  if (!isSingleFile) return removedPaths

  const getPlacementPath =
    pkg.packageType === 'AGENT' ? getAgentPlacementPath : getCommandPlacementPath
  const fileName = pkg.entryFile ?? `${shortName}.md`

  for (const agentId of pkg.agents) {
    const placementPath = getPlacementPath(agentId as AgentId, fileName, scope)
    if (!placementPath) continue
    const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
    if (!fullPath) continue
    if (existsSync(fullPath)) {
      removedPaths.push(fullPath)
    }
  }

  return removedPaths
}

/**
 * Remove a single-file AGENT/COMMAND package from disk.
 */
function removeSingleFilePackage(
  projectRoot: string,
  shortName: string,
  pkg: { agents: string[]; packageType?: string; entryFile?: string },
  scope: Scope
): void {
  const getPlacementPath =
    pkg.packageType === 'AGENT' ? getAgentPlacementPath : getCommandPlacementPath
  const fileName = pkg.entryFile ?? `${shortName}.md`

  for (const agentId of pkg.agents) {
    const placementPath = getPlacementPath(agentId as AgentId, fileName, scope)
    if (!placementPath) continue
    const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
    if (!fullPath) continue
    if (existsSync(fullPath)) {
      rmSync(fullPath, { force: true })
    }
  }
}

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
        const isBundle = pkg.packageType === 'BUNDLE'
        const isConstituent = Boolean(pkg.bundle)

        // Collect constituents if this is a bundle
        const constituents = isBundle ? findBundleConstituents(manifest, manifestKey) : []

        // Collect removal paths
        const removedPaths = isSingleFile
          ? collectSingleFileRemovalPaths(projectRoot, shortName, pkg, scope)
          : collectRemovalPaths(projectRoot, shortName, pkg, scope)

        // Also collect constituent paths for dry-run display
        const constituentPaths: Record<string, string[]> = {}
        for (const cName of constituents) {
          const cPkg = manifest.packages[cName]
          if (cPkg) {
            constituentPaths[cName] = collectRemovalPaths(projectRoot, cName, cPkg, scope)
          }
        }

        if (options.dryRun) {
          if (jsonMode) {
            outputSuccess<RemoveResult>({
              name,
              removed: false,
              paths: removedPaths,
              bundleConstituents: constituents.length > 0 ? constituents : undefined,
            })
            return
          }

          console.log(`${chalk.yellow('[dry-run]')} Would remove ${chalk.green(name)}`)

          if (isBundle && constituents.length > 0) {
            console.log(
              chalk.dim(`  Bundle — would also remove ${constituents.length} constituent(s):`)
            )
            for (const cName of constituents) {
              console.log(chalk.dim(`    • ${cName}`))
            }
          }

          const hasCanonical = isSymlinkedInstall(projectRoot, shortName, scope)
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

        // Show bundle context warnings before confirmation
        if (!jsonMode) {
          if (isBundle && constituents.length > 0) {
            console.log(
              chalk.yellow(
                `\nRemoving bundle "${name}" will also remove ${constituents.length} constituent(s):`
              )
            )
            for (const cName of constituents) {
              console.log(`  ${chalk.dim('•')} ${cName}`)
            }
            console.log()
          } else if (isConstituent) {
            console.log(
              chalk.yellow(
                `\n"${name}" was installed as part of bundle "${pkg.bundle}". Removing it individually.`
              )
            )
          }
        }

        // Confirmation prompt
        if (!options.yes && !jsonMode) {
          let confirmMessage: string
          if (isBundle && constituents.length > 0) {
            confirmMessage = `Remove bundle ${chalk.bold(name)} and all constituents?`
          } else {
            confirmMessage = `Remove ${chalk.bold(name)} and its agent symlinks?`
          }

          const { confirmed } = await prompts({
            type: 'confirm',
            name: 'confirmed',
            message: confirmMessage,
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
        const lockfile = readLockfile(projectRoot, scope)

        // Remove constituents first if this is a bundle
        if (isBundle && constituents.length > 0) {
          for (const cName of constituents) {
            const cPkg = manifest.packages[cName]
            if (cPkg) {
              removePackageFiles(projectRoot, cName, cName, cPkg, scope, manifest, lockfile)
              reportRemoval(cName)
            }
          }
        }

        // Remove the package itself
        if (isSingleFile) {
          removeSingleFilePackage(projectRoot, shortName, pkg, scope)
          delete manifest.packages[manifestKey]
          delete lockfile.packages[manifestKey]
        } else {
          removePackageFiles(projectRoot, manifestKey, shortName, pkg, scope, manifest, lockfile)
        }

        writeManifest(projectRoot, manifest, scope)
        writeLockfile(projectRoot, lockfile, scope)

        reportRemoval(name)

        const allRemovedPaths = [...removedPaths, ...Object.values(constituentPaths).flat()]

        if (jsonMode) {
          outputSuccess<RemoveResult>({
            name,
            removed: true,
            paths: allRemovedPaths,
            bundleConstituents: constituents.length > 0 ? constituents : undefined,
          })
        } else {
          const scopeLabel = scope === 'global' ? 'user' : 'project'
          let msg = `Removed ${chalk.green(name)} ${chalk.dim(`(${scopeLabel})`)}`
          if (isBundle && constituents.length > 0) {
            msg += ` and ${constituents.length} constituent(s)`
          }
          spinner.succeed(msg)
        }
      }
    )
}
