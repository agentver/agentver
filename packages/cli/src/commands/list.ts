import type { ListResult, ManifestV2Package } from '@agentver/shared'
import {
  getPackageSourceCommit,
  getPackageSourceLocation,
  getPackageSourceReference,
} from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputSuccess } from '../output.js'
import { readManifest } from '../storage/manifest'
import { getPackageDisplayName, resolveBundleDisplayName } from '../storage/package-identity'
import type { Scope } from '../utils/paths'

const SCOPE_LABELS: Record<Scope, string> = {
  project: 'Project packages',
  global: 'User packages',
}

function resolveScopes(options: { global?: boolean; all?: boolean }): Scope[] {
  if (options.all) return ['project', 'global']
  if (options.global) return ['global']
  return ['project']
}

function formatPackageLine(name: string, pkg: ManifestV2Package, indent: string): string {
  const displayName = getPackageDisplayName(name, pkg)
  const agents = pkg.agents.length > 0 ? chalk.dim(` [${pkg.agents.join(', ')}]`) : ''
  const pinned = pkg.pinned === true ? chalk.yellow(' [pinned]') : ''

  if (pkg.source.type === 'git' || pkg.source.type === 'platform') {
    const ref = getPackageSourceReference(pkg.source)
    const commit = getPackageSourceCommit(pkg.source).slice(0, 7)
    const commitDisplay = commit ? ` ${chalk.dim(`(${commit})`)}` : ''
    const sourceLabel =
      pkg.source.type === 'platform' ? chalk.dim(' [platform]') : chalk.dim(' [git]')
    return `${indent}${chalk.green(displayName)}@${chalk.cyan(ref)}${commitDisplay}${sourceLabel}${pinned}${agents}`
  }

  if (pkg.source.type === 'well-known') {
    return `${indent}${chalk.green(displayName)} ${chalk.dim(`(${getPackageSourceLocation(pkg.source)})`)} ${chalk.dim('[well-known]')}${pinned}${agents}`
  }

  if (pkg.source.type === 'local') {
    return `${indent}${chalk.green(displayName)} ${chalk.dim(`(${getPackageSourceLocation(pkg.source)})`)} ${chalk.dim('[local]')}${pinned}${agents}`
  }

  return `${indent}${chalk.green(displayName)} ${chalk.dim('[unknown]')}${pinned}${agents}`
}

type BundleGroup = {
  displayName: string
  bundlePkg?: ManifestV2Package
  constituents: Array<[string, ManifestV2Package]>
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('Show installed packages')
    .option('--global', 'List globally installed packages')
    .option('--all', 'List both project and global packages')
    .option('--json', 'Output as JSON')
    .action((options: { global?: boolean; all?: boolean; json?: boolean }) => {
      const jsonMode = isJSONMode() || options.json === true
      const scopes = resolveScopes(options)
      const projectRoot = process.cwd()
      const multiScope = scopes.length > 1

      if (jsonMode) {
        const allPackages: ListResult['packages'] = []
        for (const scope of scopes) {
          const manifest = readManifest(projectRoot, scope)
          for (const [name, pkg] of Object.entries(manifest.packages)) {
            allPackages.push({
              name: getPackageDisplayName(name, pkg),
              scope,
              package: {
                ...pkg,
                ...(pkg.bundle
                  ? {
                      bundle: resolveBundleDisplayName(manifest.packages, pkg.bundle) ?? pkg.bundle,
                    }
                  : {}),
              },
            })
          }
        }
        outputSuccess<ListResult>({ packages: allPackages })
        return
      }

      let totalEntries = 0

      for (const scope of scopes) {
        const manifest = readManifest(projectRoot, scope)
        const entries = Object.entries(manifest.packages)
        totalEntries += entries.length

        if (multiScope) {
          console.log(chalk.bold(`\n${SCOPE_LABELS[scope]} (${entries.length}):\n`))
        } else if (entries.length > 0) {
          console.log(chalk.bold(`\nInstalled packages (${entries.length}):\n`))
        }

        // Separate bundles from standalone packages
        const bundles = new Map<string, BundleGroup>()
        const standalone: [string, ManifestV2Package][] = []

        for (const [packageKey, pkg] of entries) {
          const displayName = getPackageDisplayName(packageKey, pkg)
          if (pkg.packageType === 'BUNDLE') {
            const existing = bundles.get(packageKey)
            bundles.set(packageKey, {
              displayName,
              bundlePkg: pkg,
              constituents: existing?.constituents ?? [],
            })
          } else if (pkg.bundle) {
            const bundleKey = pkg.bundle
            const existing = bundles.get(bundleKey)
            bundles.set(bundleKey, {
              displayName: resolveBundleDisplayName(manifest.packages, bundleKey) ?? bundleKey,
              bundlePkg: existing?.bundlePkg,
              constituents: [...(existing?.constituents ?? []), [packageKey, pkg]],
            })
          } else {
            standalone.push([packageKey, pkg])
          }
        }

        // Print bundle groups
        for (const [, bundleGroup] of bundles) {
          if (bundleGroup.bundlePkg) {
            console.log(
              `  ${chalk.magenta('▸')} ${formatPackageLine(bundleGroup.displayName, bundleGroup.bundlePkg, '')} ${chalk.dim('[bundle]')}`
            )
          } else {
            console.log(
              `  ${chalk.magenta('▸')} ${chalk.green(bundleGroup.displayName)} ${chalk.dim('[bundle]')}`
            )
          }

          for (const [packageKey, pkg] of bundleGroup.constituents) {
            console.log(`    ${formatPackageLine(packageKey, pkg, '')}`)
          }
        }

        // Print standalone packages
        for (const [name, pkg] of standalone) {
          console.log(formatPackageLine(name, pkg, '  '))
        }

        if (!multiScope && entries.length > 0) {
          console.log()
        }
      }

      if (multiScope) {
        console.log()
      }

      if (totalEntries === 0) {
        console.log(chalk.dim('No packages installed.'))
        return
      }
    })
}
