import type { LogoutResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import prompts from 'prompts'
import { isJSONMode, outputError, outputSuccess } from '../output.js'
import { clearCredentials, isAuthenticated } from '../registry/auth.js'
import { getPlatformUrl } from '../registry/config.js'

export function registerLogoutCommand(program: Command): void {
  program
    .command('logout')
    .description('Log out from the Agentver registry')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (options: { yes?: boolean }) => {
      const jsonMode = isJSONMode()

      if (!(await isAuthenticated())) {
        if (jsonMode) {
          outputSuccess<LogoutResult>({ cleared: true })
          return
        }
        process.stdout.write(chalk.dim('You are not currently logged in.\n'))
        return
      }

      const platformUrl = getPlatformUrl()

      if (jsonMode && !options.yes) {
        outputError('CONFIRMATION_REQUIRED', 'Use --yes flag to confirm logout in JSON mode.')
        process.exit(1)
      }

      if (!options.yes && !jsonMode) {
        const target = platformUrl ? ` from ${platformUrl}` : ''
        const { confirmed } = await prompts({
          type: 'confirm',
          name: 'confirmed',
          message: `Log out${target}? This will clear your credentials.`,
          initial: false,
        })

        if (!confirmed) {
          process.stdout.write(chalk.dim('Cancelled.\n'))
          return
        }
      }

      clearCredentials()

      if (jsonMode) {
        outputSuccess<LogoutResult>({ cleared: true })
        return
      }

      if (platformUrl) {
        process.stdout.write(
          `${chalk.green('Logged out successfully.')} Disconnected from ${platformUrl}\n`
        )
      } else {
        process.stdout.write(
          `${chalk.green('Logged out successfully.')} Run \`agentver login\` to sign in again.\n`
        )
      }
    })
}
