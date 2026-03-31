import type { LogResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { platformFetch } from '../registry/platform.js'
import { resolveCurrentSkillIdentity } from './skill-context.js'

type CommitEntry = LogResult['commits'][number]

type LogOptions = {
  limit?: string
  json?: boolean
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export function registerLogCommand(program: Command): void {
  program
    .command('log [name]')
    .description('Show commit history for a skill')
    .option('--limit <n>', 'Number of entries to show', '20')
    .option('--json', 'Output as JSON')
    .action(async (nameArg: string | undefined, options: LogOptions) => {
      const identity = resolveCurrentSkillIdentity({ nameArg })

      const json = isJSONMode() || options.json

      if (!identity) {
        const target = nameArg ?? 'current directory'
        const message = `Could not determine skill identity for "${target}". Provide a skill name or run from a skill directory.`
        if (json) {
          outputError('IDENTITY_NOT_FOUND', message)
        } else {
          process.stderr.write(chalk.red(`${message}\n`))
        }
        process.exit(1)
      }

      const limit = Number.parseInt(options.limit ?? '20', 10)
      if (Number.isNaN(limit) || limit < 1) {
        if (json) {
          outputError('VALIDATION_ERROR', 'Limit must be a positive number.')
        } else {
          process.stderr.write(chalk.red('Limit must be a positive number.\n'))
        }
        process.exit(1)
      }

      const spinner = createSpinner('Fetching history...').start()

      try {
        const params = new URLSearchParams({ limit: String(limit) })
        const commits = await platformFetch<CommitEntry[]>(
          `/skills/@${identity.org}/${identity.name}/history?${params.toString()}`
        )

        spinner.stop()

        if (json) {
          outputSuccess<LogResult>({ commits })
          return
        }

        if (commits.length === 0) {
          process.stdout.write(chalk.dim('No commits found.\n'))
          return
        }

        process.stdout.write(chalk.bold(`\nHistory for @${identity.org}/${identity.name}:\n\n`))

        for (const commit of commits) {
          const shortSha = commit.sha.slice(0, 7)
          const date = formatDate(commit.author.date || commit.createdAt)
          const firstLine = commit.message.split('\n')[0] ?? commit.message

          process.stdout.write(
            `  ${chalk.yellow(shortSha)} ${chalk.dim('|')} ${chalk.dim(date)} ${chalk.dim('|')} ${firstLine}\n`
          )
        }

        process.stdout.write('\n')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (json) {
          spinner.stop()
          outputError('FETCH_FAILED', message)
        } else {
          spinner.fail(`Failed to fetch history: ${message}`)
        }
        process.exit(1)
      }
    })
}
