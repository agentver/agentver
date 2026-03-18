import type { ListResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputSuccess } from '../output.js'
import { readManifest } from '../storage/manifest'

type Scope = 'project' | 'global'

const SCOPE_LABELS: Record<Scope, string> = {
  project: 'Project packages',
  global: 'User packages',
}

function resolveScopes(options: { global?: boolean; all?: boolean }): Scope[] {
  if (options.all) return ['project', 'global']
  if (options.global) return ['global']
  return ['project']
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('Show installed packages')
    .option('--global', 'List globally installed packages')
    .option('--all', 'List both project and global packages')
    .option('--json', 'Output as JSON')
    .action((options: { global?: boolean; all?: boolean }) => {
      const jsonMode = isJSONMode()
      const scopes = resolveScopes(options)
      const multiScope = scopes.length > 1

      if (jsonMode) {
        const allPackages: ListResult['packages'] = {}
        for (const scope of scopes) {
          const manifest = readManifest(scope)
          Object.assign(allPackages, manifest.packages)
        }
        outputSuccess<ListResult>({ packages: allPackages })
        return
      }

      let totalEntries = 0

      for (const scope of scopes) {
        const manifest = readManifest(scope)
        const entries = Object.entries(manifest.packages)
        totalEntries += entries.length

        if (multiScope) {
          console.log(chalk.bold(`\n${SCOPE_LABELS[scope]} (${entries.length}):\n`))
        } else if (entries.length > 0) {
          console.log(chalk.bold(`\nInstalled packages (${entries.length}):\n`))
        }

        for (const [name, pkg] of entries) {
          const agents = pkg.agents.length > 0 ? chalk.dim(` [${pkg.agents.join(', ')}]`) : ''
          const pinned = pkg.pinned === true ? chalk.yellow(' [pinned]') : ''

          if (pkg.source.type === 'git') {
            const ref = pkg.source.ref
            const commit = pkg.source.commit.slice(0, 7)
            console.log(
              `  ${chalk.green(name)}@${chalk.cyan(ref)} ${chalk.dim(`(${commit})`)}${pinned}${agents}`
            )
          } else {
            const hostname = pkg.source.hostname
            console.log(
              `  ${chalk.green(name)} ${chalk.dim(`(${hostname})`)} ${chalk.dim('[well-known]')}${pinned}${agents}`
            )
          }
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
