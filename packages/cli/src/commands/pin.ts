import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputError, outputSuccess } from '../output.js'
import { readManifest, writeManifest } from '../storage/manifest'

export function registerPinCommand(program: Command): void {
  program
    .command('pin <name>')
    .description('Pin a package to skip it during updates')
    .option('--global', 'Pin a package installed at user level (~/.agents/skills/)')
    .action((name: string, options: { global?: boolean }) => {
      const jsonMode = isJSONMode()
      const projectRoot = process.cwd()
      const scope = options.global ? 'global' : 'project'
      const manifest = readManifest(projectRoot, scope)
      const pkg = manifest.packages[name]

      if (!pkg) {
        if (jsonMode) {
          outputError('NOT_FOUND', `Package "${name}" is not installed.`)
        } else {
          console.error(chalk.red(`Package "${name}" is not installed.`))
        }
        process.exit(1)
      }

      pkg.pinned = true
      writeManifest(projectRoot, manifest, scope)

      if (jsonMode) {
        outputSuccess({ name, pinned: true })
        return
      }

      const scopeLabel = scope === 'global' ? 'user' : 'project'
      console.log(
        chalk.green(`Pinned ${name}`) +
          chalk.dim(` (${scopeLabel})`) +
          chalk.dim(' — this package will be skipped during updates')
      )
    })
}

export function registerUnpinCommand(program: Command): void {
  program
    .command('unpin <name>')
    .description('Unpin a package so it is included in updates')
    .option('--global', 'Unpin a package installed at user level (~/.agents/skills/)')
    .action((name: string, options: { global?: boolean }) => {
      const jsonMode = isJSONMode()
      const projectRoot = process.cwd()
      const scope = options.global ? 'global' : 'project'
      const manifest = readManifest(projectRoot, scope)
      const pkg = manifest.packages[name]

      if (!pkg) {
        if (jsonMode) {
          outputError('NOT_FOUND', `Package "${name}" is not installed.`)
        } else {
          console.error(chalk.red(`Package "${name}" is not installed.`))
        }
        process.exit(1)
      }

      delete pkg.pinned
      writeManifest(projectRoot, manifest, scope)

      if (jsonMode) {
        outputSuccess({ name, pinned: false })
        return
      }

      const scopeLabel = scope === 'global' ? 'user' : 'project'
      console.log(
        chalk.green(`Unpinned ${name}`) +
          chalk.dim(` (${scopeLabel})`) +
          chalk.dim(' — this package will be included in updates')
      )
    })
}
