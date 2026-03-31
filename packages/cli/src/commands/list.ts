import type { ListResult, ManifestV2Package } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputSuccess } from '../output.js'
import { readManifest } from '../storage/manifest'
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
  const agents = pkg.agents.length > 0 ? chalk.dim(` [${pkg.agents.join(', ')}]`) : ''
  const pinned = pkg.pinned === true ? chalk.yellow(' [pinned]') : ''

  if (pkg.source.type === 'git') {
    const ref = pkg.source.ref
    const commit = pkg.source.commit.slice(0, 7)
    const commitDisplay = commit ? ` ${chalk.dim(`(${commit})`)}` : ''
    return `${indent}${chalk.green(name)}@${chalk.cyan(ref)}${commitDisplay}${pinned}${agents}`
  }

  const hostname = pkg.source.hostname
  return `${indent}${chalk.green(name)} ${chalk.dim(`(${hostname})`)} ${chalk.dim('[well-known]')}${pinned}${agents}`
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
            allPackages.push({ name, scope, package: pkg })
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
        const bundles = new Map<string, [string, ManifestV2Package][]>()
        const standalone: [string, ManifestV2Package][] = []
        const bundleEntries: [string, ManifestV2Package][] = []

        for (const [name, pkg] of entries) {
          if (pkg.packageType === 'BUNDLE') {
            bundleEntries.push([name, pkg])
            if (!bundles.has(name)) {
              bundles.set(name, [])
            }
          } else if (pkg.bundle) {
            const existing = bundles.get(pkg.bundle) ?? []
            existing.push([name, pkg])
            bundles.set(pkg.bundle, existing)
          } else {
            standalone.push([name, pkg])
          }
        }

        // Print bundle groups
        for (const [bundleName, constituents] of bundles) {
          const bundlePkg = bundleEntries.find(([name]) => name === bundleName)?.[1]
          if (bundlePkg) {
            console.log(
              `  ${chalk.magenta('▸')} ${formatPackageLine(bundleName, bundlePkg, '')} ${chalk.dim('[bundle]')}`
            )
          } else {
            console.log(
              `  ${chalk.magenta('▸')} ${chalk.green(bundleName)} ${chalk.dim('[bundle]')}`
            )
          }

          for (const [name, pkg] of constituents) {
            console.log(`    ${formatPackageLine(name, pkg, '')}`)
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
