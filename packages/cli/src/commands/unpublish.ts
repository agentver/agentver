import type { UnpublishResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { platformFetch } from '../registry/platform.js'
import { extractError, SEMVER_REGEX } from '../utils.js'
import { resolveCurrentSkillIdentity } from './skill-context.js'

type UnpublishOptions = {
  json?: boolean
}

type UnpublishResponse = {
  version: string
  status: 'YANKED'
}

export function registerUnpublishCommand(program: Command): void {
  program
    .command('unpublish <version>')
    .description('Unpublish a published version of the current skill')
    .option('--json', 'Output as JSON')
    .action(async (version: string, options: UnpublishOptions) => {
      const jsonMode = isJSONMode() || options.json === true

      if (!SEMVER_REGEX.test(version)) {
        const message = `Invalid semver "${version}". Expected format: 1.0.0, 1.0.0-beta.1, or 1.0.0+build.42`
        if (jsonMode) {
          outputError('VALIDATION_ERROR', message)
        } else {
          process.stderr.write(chalk.red(`${message}\n`))
        }
        process.exit(1)
      }

      const identity = resolveCurrentSkillIdentity()
      if (!identity) {
        const message = 'Could not determine skill identity. Run this from a skill directory.'
        if (jsonMode) {
          outputError('NOT_FOUND', message)
        } else {
          process.stderr.write(chalk.red(`${message}\n`))
        }
        process.exit(1)
      }

      const spinner = createSpinner(`Unpublishing version ${version}...`).start()

      try {
        const result = await platformFetch<UnpublishResponse>(
          `/skills/@${identity.org}/${identity.name}/versions/${encodeURIComponent(version)}/unpublish`,
          {
            method: 'POST',
          }
        )

        if (jsonMode) {
          spinner.stop()
          outputSuccess<UnpublishResult>({
            skill: `@${identity.org}/${identity.name}`,
            version: result.version,
            status: result.status,
          })
        } else {
          spinner.succeed(`Unpublished ${chalk.green(identity.name)}@${chalk.cyan(result.version)}`)
        }
      } catch (error) {
        const { message } = extractError(error, 'UNPUBLISH_FAILED')
        if (jsonMode) {
          spinner.stop()
          outputError('UNPUBLISH_FAILED', message)
        } else {
          spinner.fail(`Failed to unpublish: ${message}`)
        }
        process.exit(1)
      }
    })
}
