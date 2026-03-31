import type { DeprecateResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { platformFetch } from '../registry/platform.js'
import { extractError, SEMVER_REGEX } from '../utils.js'
import { resolveCurrentSkillIdentity } from './skill-context.js'

type DeprecateOptions = {
  message?: string
  json?: boolean
}

type PackageDeprecateResponse = {
  status: 'DEPRECATED'
  message?: string | null
}

type VersionDeprecateResponse = {
  version: string
  status: 'DEPRECATED'
  message?: string | null
}

export function registerDeprecateCommand(program: Command): void {
  program
    .command('deprecate [version]')
    .description('Deprecate the current skill or one of its published versions')
    .option('--message <text>', 'Deprecation message or note')
    .option('--json', 'Output as JSON')
    .action(async (version: string | undefined, options: DeprecateOptions) => {
      const jsonMode = isJSONMode() || options.json === true

      if (version && !SEMVER_REGEX.test(version)) {
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

      const spinner = createSpinner(
        version ? `Deprecating version ${version}...` : 'Deprecating skill...'
      ).start()

      try {
        if (version) {
          const result = await platformFetch<VersionDeprecateResponse>(
            `/skills/@${identity.org}/${identity.name}/versions/${encodeURIComponent(version)}/deprecate`,
            {
              method: 'POST',
              body: options.message ? { message: options.message } : {},
            }
          )

          if (jsonMode) {
            spinner.stop()
            outputSuccess<DeprecateResult>({
              skill: `@${identity.org}/${identity.name}`,
              target: 'version',
              version: result.version,
              status: result.status,
              ...(result.message ? { message: result.message } : {}),
            })
          } else {
            spinner.succeed(
              `Deprecated ${chalk.green(identity.name)}@${chalk.cyan(result.version)}`
            )
            if (result.message) {
              process.stdout.write(chalk.dim(`  ${result.message}\n`))
            }
          }
          return
        }

        const result = await platformFetch<PackageDeprecateResponse>(
          `/skills/@${identity.org}/${identity.name}/deprecate`,
          {
            method: 'POST',
            body: options.message ? { message: options.message } : {},
          }
        )

        if (jsonMode) {
          spinner.stop()
          outputSuccess<DeprecateResult>({
            skill: `@${identity.org}/${identity.name}`,
            target: 'package',
            status: result.status,
            ...(result.message ? { message: result.message } : {}),
          })
        } else {
          spinner.succeed(`Deprecated ${chalk.green(`@${identity.org}/${identity.name}`)}`)
          if (result.message) {
            process.stdout.write(chalk.dim(`  ${result.message}\n`))
          }
        }
      } catch (error) {
        const { message } = extractError(error, 'DEPRECATE_FAILED')
        if (jsonMode) {
          spinner.stop()
          outputError('DEPRECATE_FAILED', message)
        } else {
          spinner.fail(`Failed to deprecate: ${message}`)
        }
        process.exit(1)
      }
    })
}
