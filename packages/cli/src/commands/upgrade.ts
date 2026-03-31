import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { UpgradeResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { SEMVER_REGEX } from '../utils.js'

const execFileAsync = promisify(execFile)
const PACKAGE_NAME = '@agentver/cli'

type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn'

type UpgradeOptions = {
  check?: boolean
  dryRun?: boolean
  json?: boolean
  version?: string
}

function getCurrentVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const require = createRequire(import.meta.url)
  const pkg = require(join(__dirname, '..', 'package.json')) as { version: string }
  return pkg.version
}

async function resolveTargetVersion(targetVersion?: string): Promise<string> {
  if (targetVersion && !SEMVER_REGEX.test(targetVersion)) {
    throw new Error(`Invalid version "${targetVersion}". Expected a valid semver version.`)
  }

  const suffix = targetVersion ? `/${targetVersion}` : '/latest'
  const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}${suffix}`)
  if (!response.ok) {
    if (!targetVersion) {
      throw new Error(`Failed to check for updates: ${response.statusText}`)
    }
    throw new Error(`Failed to resolve version ${targetVersion}: ${response.statusText}`)
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

function getInstallArgs(pm: PackageManager, version: string): string[] {
  switch (pm) {
    case 'bun':
      return ['install', '-g', `${PACKAGE_NAME}@${version}`]
    case 'pnpm':
      return ['add', '-g', `${PACKAGE_NAME}@${version}`]
    case 'yarn':
      return ['global', 'add', `${PACKAGE_NAME}@${version}`]
    case 'npm':
      return ['install', '-g', `${PACKAGE_NAME}@${version}`]
  }
}

function getManualInstallHint(pm: PackageManager, version: string, useLatestTag = false): string {
  const args = getInstallArgs(pm, useLatestTag ? 'latest' : version)
  return `${pm} ${args.join(' ')}`
}

async function verifyInstalledVersion(
  pm: PackageManager,
  expectedVersion: string,
  useLatestTag = false
): Promise<void> {
  const args = getListArgs(pm)
  const { stdout } = await execFileAsync(pm, args, { timeout: 10000 })

  if (!stdout.includes(expectedVersion)) {
    throw new Error(
      `Upgrade appeared to succeed but the installed version does not match v${expectedVersion}.\n` +
        `Try installing directly: ${getManualInstallHint(pm, expectedVersion, useLatestTag)}`
    )
  }
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .alias('self-update')
    .description('Upgrade Agentver CLI to the latest version')
    .option('--check', 'Check for updates without installing them')
    .option('--dry-run', 'Alias for --check')
    .option('--version <version>', 'Upgrade to a specific published version')
    .option('--json', 'Output as JSON')
    .action(async (options: UpgradeOptions) => {
      const json = isJSONMode() || options.json === true
      const checkOnly = options.check === true || options.dryRun === true
      const spinner = createSpinner('Checking for updates…')
      spinner.start()

      try {
        const currentVersion = getCurrentVersion()
        const latestVersion = await resolveTargetVersion(options.version)

        const baseResult: UpgradeResult = {
          current: currentVersion,
          previous: currentVersion,
          latest: latestVersion,
          upToDate: currentVersion === latestVersion,
          checkedOnly: checkOnly,
          targetVersion: options.version,
        }

        if (currentVersion === latestVersion) {
          if (json) {
            outputSuccess<UpgradeResult>(baseResult)
          } else {
            spinner.succeed(`Already on the latest version ${chalk.green(`v${currentVersion}`)}`)
          }
          return
        }

        if (checkOnly) {
          if (json) {
            outputSuccess<UpgradeResult>(baseResult)
          } else {
            spinner.succeed(
              `Update available: ${chalk.green(`v${currentVersion}`)} → ${chalk.green(`v${latestVersion}`)}`
            )
          }
          return
        }

        spinner.text = `Upgrading ${chalk.dim(`v${currentVersion}`)} → ${chalk.green(`v${latestVersion}`)}…`

        const pm = await detectPackageManager()
        const args = getInstallArgs(pm, latestVersion)

        await execFileAsync(pm, args, { timeout: 60000 })
        await verifyInstalledVersion(pm, latestVersion, !options.version)

        if (json) {
          const result: UpgradeResult = { ...baseResult, packageManager: pm, checkedOnly: false }
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
