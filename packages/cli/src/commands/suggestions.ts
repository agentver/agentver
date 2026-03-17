import type { ProposalsResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { getCredentials } from '../registry/auth.js'
import { getPlatformUrl } from '../registry/config.js'

const HTTP_TIMEOUT_MS = 15_000

type SuggestionStatus = 'OPEN' | 'IN_REVIEW' | 'APPROVED' | 'MERGED' | 'REJECTED' | 'CLOSED'

type Suggestion = {
  id: string
  title: string
  packageSlug: string
  status: SuggestionStatus
  author: string
  createdAt: string
}

type SuggestionsResponse = {
  suggestions: Suggestion[]
}

async function getFromPlatform<T>(path: string): Promise<T> {
  const platformUrl = getPlatformUrl()
  if (!platformUrl) {
    throw new Error('Not connected to a platform. Run `agentver login <url>` first.')
  }

  const creds = await getCredentials()
  if (!creds?.token && !creds?.apiKey) {
    throw new Error('Not connected to a platform. Run `agentver login <url>` first.')
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'agentver-cli',
  }

  if (creds.token) {
    headers.Authorization = `Bearer ${creds.token}`
  } else if (creds.apiKey) {
    headers['X-API-Key'] = creds.apiKey
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)

  try {
    const url = `${platformUrl}/api/v1${path}`
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error')
      throw new Error(`Platform returned ${response.status}: ${errorBody}`)
    }

    return (await response.json()) as T
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Platform request timed out')
    }
    throw error
  }
}

function formatDate(isoDate: string): string {
  try {
    const date = new Date(isoDate)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  } catch {
    return isoDate
  }
}

const STATUS_COLOURS: Record<SuggestionStatus, (text: string) => string> = {
  OPEN: chalk.green,
  IN_REVIEW: chalk.yellow,
  APPROVED: chalk.blue,
  MERGED: chalk.magenta,
  REJECTED: chalk.red,
  CLOSED: chalk.dim,
}

function formatSuggestionRow(
  suggestion: Suggestion,
  idWidth: number,
  titleWidth: number,
  slugWidth: number,
  authorWidth: number
): string {
  const id = chalk.dim(`#${suggestion.id}`.padEnd(idWidth + 1))
  const title = suggestion.title.padEnd(titleWidth)
  const slug = chalk.cyan(suggestion.packageSlug.padEnd(slugWidth))
  const statusFn = STATUS_COLOURS[suggestion.status] ?? chalk.dim
  const status = statusFn(suggestion.status.padEnd(11))
  const author = chalk.dim(suggestion.author.padEnd(authorWidth))
  const date = chalk.dim(formatDate(suggestion.createdAt))

  return `  ${id}  ${title}  ${slug}  ${status}  ${author}  ${date}`
}

export function registerSuggestionsCommand(program: Command): void {
  program
    .command('suggestions [name]')
    .alias('proposals')
    .description('List suggestions for a skill (requires platform connection)')
    .option('-s, --status <status>', 'Filter by status (open, closed, merged, all)', 'open')
    .action(async (name: string | undefined, options: { status: string }) => {
      const json = isJSONMode()
      const platformUrl = getPlatformUrl()
      const creds = await getCredentials()

      if (!platformUrl || (!creds?.token && !creds?.apiKey)) {
        if (json) {
          outputError(
            'AUTH_REQUIRED',
            'Not connected to a platform. Run `agentver login <url>` first.'
          )
          process.exit(1)
        }
        console.error(chalk.red('Not connected to a platform. Run `agentver login <url>` first.'))
        process.exit(1)
      }

      const spinner = createSpinner('Fetching suggestions...').start()

      try {
        const queryParams = new URLSearchParams()
        if (name) {
          queryParams.set('package', name)
        }

        const statusFilter = options.status.toUpperCase()
        if (statusFilter !== 'ALL') {
          queryParams.set('status', statusFilter)
        }

        const queryString = queryParams.toString()
        const queryPath = `/proposals${queryString ? `?${queryString}` : ''}`
        const { suggestions } = await getFromPlatform<SuggestionsResponse>(queryPath)

        spinner.stop()

        if (json) {
          outputSuccess<ProposalsResult>({
            proposals: suggestions.map((s) => ({
              id: s.id,
              title: s.title,
              status: s.status,
              author: s.author,
              packageName: s.packageSlug,
              createdAt: s.createdAt,
            })),
          })
          return
        }

        if (suggestions.length === 0) {
          const filterLabel = statusFilter === 'ALL' ? '' : ` ${options.status}`
          console.log(chalk.dim(`No${filterLabel} suggestions found.`))
          return
        }

        const idWidth = Math.max(...suggestions.map((s) => `#${s.id}`.length))
        const titleWidth = Math.max(...suggestions.map((s) => s.title.length))
        const slugWidth = Math.max(...suggestions.map((s) => s.packageSlug.length))
        const authorWidth = Math.max(...suggestions.map((s) => s.author.length))

        const heading =
          statusFilter === 'ALL'
            ? `Suggestions (${suggestions.length})`
            : `${options.status.charAt(0).toUpperCase() + options.status.slice(1)} suggestions (${suggestions.length})`

        console.log(chalk.bold(`\n${heading}:\n`))

        for (const suggestion of suggestions) {
          console.log(formatSuggestionRow(suggestion, idWidth, titleWidth, slugWidth, authorWidth))
        }

        console.log()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        spinner.fail(`Failed to fetch suggestions: ${message}`)
        if (json) {
          outputError('FETCH_FAILED', message)
        }
        process.exit(1)
      }
    })
}
