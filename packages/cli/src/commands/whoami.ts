import type { WhoamiResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputError, outputSuccess } from '../output.js'
import { getCredentials } from '../registry/auth.js'
import { getPlatformUrl } from '../registry/config.js'
import { platformFetchSilent } from '../registry/platform.js'
import { extractError } from '../utils.js'

type MeResponse = {
  id: string
  email: string
  name: string
  organisations: Array<{ slug: string; name: string; role: string }>
}

export function registerWhoamiCommand(program: Command): void {
  program
    .command('whoami')
    .description('Show authentication state')
    .action(async () => {
      const credentials = await getCredentials()

      if (!credentials?.token && !credentials?.apiKey) {
        if (isJSONMode()) {
          outputSuccess<WhoamiResult>({ authenticated: false })
          return
        }
        console.log(chalk.dim('Not authenticated. Run `agentver login` to sign in.'))
        return
      }

      const platformUrl = getPlatformUrl()

      if (!platformUrl) {
        if (!isJSONMode()) {
          if (credentials.apiKey) {
            const prefix = credentials.apiKey.slice(0, 8)
            console.log(`Authenticated via API key: ${chalk.green(`${prefix}...`)}`)
          } else {
            console.log(chalk.green('Authenticated via OAuth.'))
          }
        }

        if (isJSONMode()) {
          outputSuccess<WhoamiResult>({ authenticated: true })
          return
        }
        console.log(chalk.dim('Platform: not connected (run `agentver login <url>` to connect)'))
        return
      }

      let me: MeResponse | null = null
      let warning: string | undefined

      try {
        me = await platformFetchSilent<MeResponse>('/me', { swallowAuthErrors: false })
      } catch (error) {
        const { code, message } = extractError(error, 'WHOAMI_FAILED')
        if (code === 'UNAUTHORISED' || message.startsWith('Authentication expired')) {
          if (isJSONMode()) {
            outputError('UNAUTHORISED', message)
          } else {
            console.log(chalk.red(message))
          }
          process.exitCode = 1
          return
        }

        warning = 'Could not verify identity against the platform.'
      }

      if (!isJSONMode()) {
        if (credentials.apiKey) {
          const prefix = credentials.apiKey.slice(0, 8)
          console.log(`Authenticated via API key: ${chalk.green(`${prefix}...`)}`)
        } else {
          console.log(chalk.green('Authenticated via OAuth.'))
        }
        console.log(`Platform: ${chalk.cyan(platformUrl)}`)
      }

      if (isJSONMode()) {
        const result: WhoamiResult = {
          authenticated: true,
          platform: platformUrl,
        }
        if (me) {
          result.user = { id: me.id, email: me.email, name: me.name }
          if (me.organisations.length > 0) {
            result.organisation = me.organisations.map((o) => o.slug).join(', ')
          }
        }
        outputSuccess(result, warning ? [warning] : undefined)
        return
      }

      if (!me) {
        if (warning) {
          console.log(chalk.yellow(warning))
        }
        return
      }

      console.log(`User: ${me.email}`)

      if (me.organisations.length > 0) {
        const orgSlugs = me.organisations.map((o) => o.slug).join(', ')
        console.log(`Organisations: ${orgSlugs}`)
      }
    })
}
