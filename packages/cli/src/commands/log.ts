import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { platformFetch } from '../registry/platform.js'
import { readManifest } from '../storage/manifest.js'

type CommitEntry = {
  sha: string
  message: string
  author: { name: string; email: string; date: string }
  createdAt: string
}

type LogOptions = {
  limit?: string
  json?: boolean
}

/**
 * Resolve the skill identity from a name argument or the current directory.
 */
function resolveSkillIdentity(nameArg?: string): { org: string; name: string } | null {
  const cwd = process.cwd()
  const manifest = readManifest(cwd)

  // If a name was provided, look it up in the manifest
  if (nameArg) {
    const entry = manifest.packages[nameArg]
    if (entry?.source.type === 'git') {
      const parts = entry.source.uri.split('/')
      const org = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
      if (org) {
        return { org, name: nameArg }
      }
    }
    return null
  }

  // No name provided — detect from current directory
  const skillMdPath = join(cwd, 'SKILL.md')
  let skillName: string | null = null

  if (existsSync(skillMdPath)) {
    const content = readFileSync(skillMdPath, 'utf-8')
    const nameMatch = content.match(/^name:\s*(.+)$/m)
    skillName = nameMatch?.[1]?.trim() ?? basename(cwd)
  }

  if (!skillName) {
    skillName = basename(cwd)
  }

  const entry = manifest.packages[skillName]
  if (entry?.source.type === 'git') {
    const parts = entry.source.uri.split('/')
    const org = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
    if (org) {
      return { org, name: skillName }
    }
  }

  // Fallback: directory structure
  const pathParts = cwd.split('/')
  const skillsIdx = pathParts.lastIndexOf('skills')
  if (skillsIdx >= 0 && pathParts.length > skillsIdx + 2) {
    return { org: pathParts[skillsIdx + 1]!, name: skillName }
  }

  return null
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
      const identity = resolveSkillIdentity(nameArg)

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
          outputSuccess({ commits })
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
