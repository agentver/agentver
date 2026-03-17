import type { ListResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputSuccess } from '../output.js'
import { readManifest } from '../storage/manifest'

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('Show installed packages')
    .option('--json', 'Output as JSON')
    .action(() => {
      const jsonMode = isJSONMode()
      const manifest = readManifest(process.cwd())
      const entries = Object.entries(manifest.packages)

      if (jsonMode) {
        outputSuccess<ListResult>({ packages: manifest.packages })
        return
      }

      if (entries.length === 0) {
        console.log(chalk.dim('No packages installed.'))
        return
      }

      console.log(chalk.bold(`\nInstalled packages (${entries.length}):\n`))

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

      console.log()
    })
}
