import { existsSync, rmSync } from 'node:fs'
import {
  type AgentId,
  getAgentPlacementPath,
  getCommandPlacementPath,
  getSkillPlacementPath,
} from '@agentver/agent-definitions'
import type { LockfileV2, RemoveResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import prompts from 'prompts'
import { findReverseDependencies } from '../dependency-check.js'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { reportRemoval } from '../registry/reporter.js'
import {
  getCanonicalSkillPath,
  isSymlink,
  isSymlinkedInstall,
  removeAgentSymlinks,
  removeCanonicalDirectory,
} from '../storage/canonical'
import { readManifest } from '../storage/manifest'
import {
  getDisplayName,
  resolveBundleDisplayName,
  resolvePackageQuery,
} from '../storage/package-identity'
import { updateManifestAndLockfile } from '../storage/pair'
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
  lockfile: LockfileV2
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
        const lookup = resolvePackageQuery(manifest.packages, name)

        if (!lookup.ok) {
          const caseMatches = Object.keys(manifest.packages).filter(
            (key) =>
              (key.toLowerCase() === name.toLowerCase() ||
                getDisplayName(key, manifest.packages[key]!).toLowerCase() ===
                  name.toLowerCase()) &&
              key !== name
          )

          const otherScope: Scope = scope === 'project' ? 'global' : 'project'
          const otherManifest = readManifest(projectRoot, otherScope)
          const foundInOther = resolvePackageQuery(otherManifest.packages, name).ok

          const hints: string[] = []
          if (caseMatches.length > 0) {
            hints.push(`Did you mean: ${caseMatches.join(', ')}?`)
          }
          if (lookup.reason === 'ambiguous' && lookup.matches.length > 0) {
            hints.push(`Matches: ${lookup.matches.join(', ')}`)
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

        const manifestKey = lookup.key
        const displayName = lookup.displayName
        const pkg = manifest.packages[manifestKey]!
        const isSingleFile = pkg.packageType === 'AGENT' || pkg.packageType === 'COMMAND'
        const isBundle = pkg.packageType === 'BUNDLE'
        const isConstituent = Boolean(pkg.bundle)
        const bundleDisplayName = resolveBundleDisplayName(manifest.packages, pkg.bundle)
        const shortName = displayName.split('/').pop()!

        // Collect constituents if this is a bundle
        const constituents = isBundle ? findBundleConstituents(manifest, manifestKey) : []
        const constituentDisplayNames = constituents.map((key) =>
          getDisplayName(key, manifest.packages[key]!)
        )

        // Collect removal paths
        const removedPaths = isSingleFile
          ? collectSingleFileRemovalPaths(projectRoot, shortName, pkg, scope)
          : collectRemovalPaths(projectRoot, shortName, pkg, scope)

        // Also collect constituent paths for dry-run display
        const constituentPaths: Record<string, string[]> = {}
        for (const cName of constituents) {
          const cPkg = manifest.packages[cName]
          if (cPkg) {
            const constituentDisplayName = getDisplayName(cName, cPkg)
            const constituentShortName = constituentDisplayName.split('/').pop()!
            constituentPaths[constituentDisplayName] = collectRemovalPaths(
              projectRoot,
              constituentShortName,
              cPkg,
              scope
            )
          }
        }

        if (options.dryRun) {
          if (jsonMode) {
            outputSuccess<RemoveResult>({
              name: displayName,
              removed: false,
              paths: removedPaths,
              bundleConstituents:
                constituentDisplayNames.length > 0 ? constituentDisplayNames : undefined,
            })
            return
          }

          console.log(`${chalk.yellow('[dry-run]')} Would remove ${chalk.green(displayName)}`)

          if (isBundle && constituents.length > 0) {
            console.log(
              chalk.dim(`  Bundle — would also remove ${constituents.length} constituent(s):`)
            )
            for (const cName of constituentDisplayNames) {
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

        // Check for reverse dependencies — other packages that depend on this one
        const reverseDeps = findReverseDependencies(manifestKey, manifest)

        // Show bundle context warnings before confirmation
        if (!jsonMode) {
          if (isBundle && constituents.length > 0) {
            console.log(
              chalk.yellow(
                `\nRemoving bundle "${displayName}" will also remove ${constituents.length} constituent(s):`
              )
            )
            for (const cName of constituents) {
              console.log(`  ${chalk.dim('•')} ${getDisplayName(cName, manifest.packages[cName]!)}`)
            }
            console.log()
          } else if (isConstituent) {
            console.log(
              chalk.yellow(
                `\n"${displayName}" was installed as part of bundle "${bundleDisplayName ?? pkg.bundle ?? 'unknown'}". Removing it individually.`
              )
            )
          }

          if (reverseDeps.length > 0) {
            console.log(
              chalk.yellow(
                `\nWarning: the following installed packages depend on "${displayName}":`
              )
            )
            for (const dep of reverseDeps) {
              console.log(`  ${chalk.dim('•')} ${dep.name}`)
            }
            console.log(chalk.dim('  Removing it may break these packages.\n'))
          }
        }

        // Confirmation prompt
        if (!options.yes && !jsonMode) {
          let confirmMessage: string
          if (isBundle && constituents.length > 0) {
            confirmMessage = `Remove bundle ${chalk.bold(displayName)} and all constituents?`
          } else {
            confirmMessage = `Remove ${chalk.bold(displayName)} and its agent symlinks?`
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

        const spinner = createSpinner(`Removing ${displayName}...`).start()

        updateManifestAndLockfile(projectRoot, scope, (currentManifest, currentLockfile) => {
          if (isBundle && constituents.length > 0) {
            for (const cName of constituents) {
              const cPkg = currentManifest.packages[cName]
              if (cPkg) {
                const constituentDisplayName = getDisplayName(cName, cPkg)
                const constituentShortName = constituentDisplayName.split('/').pop()!
                removePackageFiles(
                  projectRoot,
                  cName,
                  constituentShortName,
                  cPkg,
                  scope,
                  currentManifest,
                  currentLockfile
                )
                reportRemoval(constituentDisplayName)
              }
            }
          }

          if (isSingleFile) {
            removeSingleFilePackage(projectRoot, shortName, pkg, scope)
            delete currentManifest.packages[manifestKey]
            delete currentLockfile.packages[manifestKey]
          } else {
            removePackageFiles(
              projectRoot,
              manifestKey,
              shortName,
              pkg,
              scope,
              currentManifest,
              currentLockfile
            )
          }

          return { manifest: currentManifest, lockfile: currentLockfile }
        })

        reportRemoval(displayName)

        const allRemovedPaths = [...removedPaths, ...Object.values(constituentPaths).flat()]

        const reverseDepWarnings =
          reverseDeps.length > 0
            ? [
                `Warning: ${reverseDeps.map((d) => d.name).join(', ')} depend(s) on "${displayName}" — they may be broken now.`,
              ]
            : []

        if (jsonMode) {
          outputSuccess<RemoveResult>(
            {
              name: displayName,
              removed: true,
              paths: allRemovedPaths,
              bundleConstituents:
                constituentDisplayNames.length > 0 ? constituentDisplayNames : undefined,
            },
            reverseDepWarnings.length > 0 ? reverseDepWarnings : undefined
          )
        } else {
          const scopeLabel = scope === 'global' ? 'user' : 'project'
          let msg = `Removed ${chalk.green(displayName)} ${chalk.dim(`(${scopeLabel})`)}`
          if (isBundle && constituents.length > 0) {
            msg += ` and ${constituents.length} constituent(s)`
          }
          spinner.succeed(msg)
        }
      }
    )
}
