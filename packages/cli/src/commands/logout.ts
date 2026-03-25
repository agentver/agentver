import type { LogoutResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import prompts from 'prompts'
import { isJSONMode, outputError, outputSuccess } from '../output.js'
import { clearCredentials, isAuthenticated } from '../registry/auth.js'
import { getPlatformUrl, readConfig, writeConfig } from '../registry/config.js'

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
        console.log(chalk.dim('You are not currently logged in.'))
        return
      }

      const platformUrl = getPlatformUrl()

      if (!options.yes && !jsonMode) {
        const target = platformUrl ? ` from ${platformUrl}` : ''
        const { confirmed } = await prompts({
          type: 'confirm',
          name: 'confirmed',
          message: `Log out${target}? This will clear your credentials.`,
          initial: false,
        })

        if (!confirmed) {
          console.log(chalk.dim('Cancelled.'))
          return
        }
      }

      if (jsonMode && !options.yes) {
        outputError('CONFIRMATION_REQUIRED', 'Use --yes flag to confirm logout in JSON mode.')
        process.exit(1)
      }

      clearCredentials()

      if (platformUrl) {
        const config = readConfig()
        delete config.platformUrl
        writeConfig(config)
      }

      if (jsonMode) {
        outputSuccess<LogoutResult>({ cleared: true })
        return
      }

      if (platformUrl) {
        console.log(`${chalk.green('Logged out successfully.')} Disconnected from ${platformUrl}`)
      } else {
        console.log(
          `${chalk.green('Logged out successfully.')} Run \`agentver login\` to sign in again.`
        )
      }
    })
}
