import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'

const execFileAsync = promisify(execFile)
const PACKAGE_NAME = '@agentver/cli'

type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn'

type UpgradeResult = {
  previous: string
  latest: string
  packageManager: PackageManager
}

function getCurrentVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const require = createRequire(import.meta.url)
  const pkg = require(join(__dirname, '..', 'package.json')) as { version: string }
  return pkg.version
}

async function getLatestVersion(): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`)
  if (!response.ok) {
    throw new Error(`Failed to check for updates: ${response.statusText}`)
  }
  const data = (await response.json()) as { version: string }
  return data.version
}

function getListArgs(pm: PackageManager): string[] {
  switch (pm) {
    case 'bun':
      return ['pm', 'ls', '-g']
    case 'pnpm':
      return ['list', '-g', PACKAGE_NAME, '--depth=0']
    case 'yarn':
      return ['global', 'list', '--depth=0']
    case 'npm':
      return ['list', '-g', PACKAGE_NAME, '--depth=0']
  }
}

async function detectPackageManager(): Promise<PackageManager> {
  const managers: PackageManager[] = ['bun', 'pnpm', 'yarn', 'npm']

  for (const pm of managers) {
    try {
      const { stdout } = await execFileAsync(pm, ['--version'], { timeout: 5000 })
      if (stdout.trim()) {
        const { stdout: listOut } = await execFileAsync(pm, getListArgs(pm), {
          timeout: 10000,
        }).catch(() => ({ stdout: '' }))

        if (listOut.includes('agentver')) {
          return pm
        }
      }
    } catch {}
  }

  return 'npm'
}

function getInstallArgs(pm: PackageManager): string[] {
  switch (pm) {
    case 'bun':
      return ['install', '-g', `${PACKAGE_NAME}@latest`]
    case 'pnpm':
      return ['add', '-g', `${PACKAGE_NAME}@latest`]
    case 'yarn':
      return ['global', 'add', `${PACKAGE_NAME}@latest`]
    case 'npm':
      return ['install', '-g', `${PACKAGE_NAME}@latest`]
  }
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .alias('self-update')
    .description('Upgrade Agentver CLI to the latest version')
    .action(async () => {
      const json = isJSONMode()
      const spinner = createSpinner('Checking for updates…')
      spinner.start()

      try {
        const currentVersion = getCurrentVersion()
        const latestVersion = await getLatestVersion()

        if (currentVersion === latestVersion) {
          if (json) {
            outputSuccess({ current: currentVersion, latest: latestVersion, upToDate: true })
          } else {
            spinner.succeed(`Already on the latest version ${chalk.green(`v${currentVersion}`)}`)
          }
          return
        }

        spinner.text = `Upgrading ${chalk.dim(`v${currentVersion}`)} → ${chalk.green(`v${latestVersion}`)}…`

        const pm = await detectPackageManager()
        const args = getInstallArgs(pm)

        await execFileAsync(pm, args, { timeout: 60000 })

        if (json) {
          const result: UpgradeResult = {
            previous: currentVersion,
            latest: latestVersion,
            packageManager: pm,
          }
          outputSuccess(result)
        } else {
          spinner.succeed(
            `Upgraded ${chalk.green(`v${currentVersion}`)} → ${chalk.green(`v${latestVersion}`)} via ${pm}`
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (json) {
          outputError('UPGRADE_FAILED', message)
          process.exit(1)
        } else {
          spinner.fail(`Upgrade failed: ${message}`)
          process.exit(1)
        }
      }
    })
}
