import type { LogoutResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputSuccess } from '../output.js'
import { clearCredentials, isAuthenticated } from '../registry/auth.js'
import { getPlatformUrl, readConfig, writeConfig } from '../registry/config.js'

export function registerLogoutCommand(program: Command): void {
  program
    .command('logout')
    .description('Log out from the Agentver registry')
    .action(async () => {
      if (!(await isAuthenticated())) {
        if (isJSONMode()) {
          outputSuccess<LogoutResult>({ cleared: true })
          return
        }
        console.log(chalk.dim('You are not currently logged in.'))
        return
      }

      const platformUrl = getPlatformUrl()

      clearCredentials()

      if (platformUrl) {
        const config = readConfig()
        delete config.platformUrl
        writeConfig(config)
      }

      if (isJSONMode()) {
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
