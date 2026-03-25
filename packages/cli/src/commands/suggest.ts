import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import type { ManifestV2Package, ProposeResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { readFilesFromDirectory } from '../git/fetcher.js'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { getCredentials } from '../registry/auth.js'
import { getPlatformUrl } from '../registry/config.js'
import { computeSha256FromFiles } from '../storage/integrity.js'
import { readLockfile } from '../storage/lockfile.js'
import { readManifest } from '../storage/manifest.js'
import { extractError } from '../utils.js'

const HTTP_TIMEOUT_MS = 15_000

type SuggestionFile = {
  path: string
  content: string
}

type SuggestionRequest = {
  title: string
  description?: string
  files: SuggestionFile[]
}

type SuggestionResponse = {
  id: string
  title: string
  url?: string
}

type SuggestionOutcome = {
  package: string
  success: boolean
  result?: ProposeResult
  error?: string
}

async function readLocalFiles(
  projectRoot: string,
  packageName: string,
  agents: string[]
): Promise<SuggestionFile[]> {
  for (const agentId of agents) {
    const placementPath = getSkillPlacementPath(agentId as AgentId, packageName, 'project')
    if (!placementPath) continue

    const fullPath = join(projectRoot, placementPath)
    if (!existsSync(fullPath)) continue

    const files = await readFilesFromDirectory(fullPath)
    return files.map((f) => ({ path: f.path, content: f.content }))
  }

  return []
}

async function postToPlatform<T>(path: string, body: unknown): Promise<T> {
  const platformUrl = getPlatformUrl()
  if (!platformUrl) {
    throw new Error('Not connected to a platform. Run `agentver login <url>` first.')
  }

  const creds = await getCredentials()
  if (!creds?.token && !creds?.apiKey) {
    throw new Error('Not connected to a platform. Run `agentver login <url>` first.')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
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
      method: 'POST',
      headers,
      body: JSON.stringify(body),
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

function buildEndpoint(manifestEntry: ManifestV2Package, packageName: string): string {
  if (manifestEntry.source.type !== 'git') return ''
  const orgSlug = manifestEntry.source.uri.split('/')[1] ?? ''
  return `/skills/@${orgSlug}/${packageName}/suggestions`
}

async function submitSuggestion(
  projectRoot: string,
  packageName: string,
  manifestEntry: ManifestV2Package,
  title: string,
  description?: string
): Promise<{ localFiles: SuggestionFile[]; result: SuggestionResponse }> {
  const localFiles = await readLocalFiles(projectRoot, packageName, manifestEntry.agents)

  if (localFiles.length === 0) {
    throw new Error(`No local files found for "${packageName}".`)
  }

  const endpoint = buildEndpoint(manifestEntry, packageName)

  const requestBody: SuggestionRequest = {
    title,
    description,
    files: localFiles,
  }

  const result = await postToPlatform<SuggestionResponse>(endpoint, requestBody)
  return { localFiles, result }
}

export function registerSuggestCommand(program: Command): void {
  program
    .command('suggest <title>')
    .alias('propose')
    .description('Create a suggestion from local modifications (requires platform connection)')
    .option('-d, --description <text>', 'Suggestion description')
    .option('--name <name>', 'Target a specific modified package by name')
    .option('--dry-run', 'Show what would be suggested without submitting')
    .action(
      async (title: string, options: { description?: string; name?: string; dryRun?: boolean }) => {
        const json = isJSONMode()
        const platformUrl = getPlatformUrl()
        const creds = await getCredentials()

        if (!options.dryRun && (!platformUrl || (!creds?.token && !creds?.apiKey))) {
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

        const projectRoot = process.cwd()
        const manifest = readManifest(projectRoot)
        const lockfile = readLockfile(projectRoot)

        const modifiedPackages: string[] = []

        for (const [name, manifestEntry] of Object.entries(manifest.packages)) {
          const lockfileEntry = lockfile.packages[name]
          if (!lockfileEntry) continue

          const { agents } = manifestEntry
          const localFiles = await readLocalFiles(projectRoot, name, agents)
          if (localFiles.length === 0) continue

          const currentIntegrity = computeSha256FromFiles(localFiles)
          if (currentIntegrity !== lockfileEntry.integrity) {
            modifiedPackages.push(name)
          }
        }

        if (modifiedPackages.length === 0) {
          if (json) {
            outputError('NO_CHANGES', 'No modified packages detected.')
            process.exit(1)
          }
          console.log(chalk.dim('No modified packages detected.'))
          return
        }

        const targets = options.name
          ? modifiedPackages.filter((n) => n === options.name)
          : modifiedPackages

        if (targets.length === 0 && options.name) {
          const message = `Package "${options.name}" is not in the modified list. Modified: ${modifiedPackages.join(', ')}`
          if (json) {
            outputError('NOT_FOUND', message)
            process.exit(1)
          }
          console.error(chalk.red(message))
          process.exit(1)
        }

        const unsupportedTargets = targets.filter(
          (name) => manifest.packages[name]?.source.type === 'well-known'
        )

        if (unsupportedTargets.length > 0) {
          for (const name of unsupportedTargets) {
            const source = manifest.packages[name]!.source
            if (json) {
              outputError(
                'UNSUPPORTED_SOURCE',
                `Package "${name}" was installed from a well-known source. Suggestions are not supported.`
              )
            } else {
              console.error(
                chalk.red(
                  `Package "${name}" was installed from a well-known source (${source.type === 'well-known' ? source.hostname : 'unknown'}).`
                )
              )
              console.error(chalk.dim('Suggestions are not supported for well-known sources.'))
            }
          }
        }

        const validTargets = targets.filter((n) => !unsupportedTargets.includes(n))

        if (validTargets.length === 0) {
          if (json) {
            outputError('NO_VALID_TARGETS', 'No valid targets for suggestion.')
          }
          process.exit(1)
        }

        if (options.dryRun) {
          const dryRunResults = []

          for (const targetName of validTargets) {
            const manifestEntry = manifest.packages[targetName]!
            const localFiles = await readLocalFiles(projectRoot, targetName, manifestEntry.agents)
            const endpoint = `/api/v1${buildEndpoint(manifestEntry, targetName)}`

            dryRunResults.push({
              package: targetName,
              title,
              description: options.description,
              files: localFiles.map((f) => ({
                path: f.path,
                contentLength: f.content.length,
              })),
              endpoint,
            })
          }

          if (json) {
            outputSuccess(dryRunResults)
          } else {
            console.log(chalk.bold('\nDry run — suggestion preview:\n'))
            for (const entry of dryRunResults) {
              console.log(`  ${chalk.dim('Package:')}  ${entry.package}`)
              console.log(`  ${chalk.dim('Title:')}    ${entry.title}`)
              if (entry.description) {
                console.log(`  ${chalk.dim('Desc:')}     ${entry.description}`)
              }
              console.log(`  ${chalk.dim('Files:')}`)
              for (const f of entry.files) {
                console.log(`    ${chalk.cyan(f.path)} (${f.contentLength} bytes)`)
              }
              console.log(`  ${chalk.dim('Endpoint:')} ${entry.endpoint}`)
              console.log()
            }
            console.log(
              chalk.dim(
                `${dryRunResults.length} package${dryRunResults.length === 1 ? '' : 's'} would get suggestions.`
              )
            )
          }
          return
        }

        const outcomes: SuggestionOutcome[] = []

        for (const targetName of validTargets) {
          const manifestEntry = manifest.packages[targetName]!
          const spinner = createSpinner(`Creating suggestion for ${targetName}...`).start()

          try {
            const { result } = await submitSuggestion(
              projectRoot,
              targetName,
              manifestEntry,
              title,
              options.description
            )

            const proposeResult: ProposeResult = {
              proposalId: result.id,
              title: result.title ?? title,
              url: result.url ?? '',
            }

            outcomes.push({ package: targetName, success: true, result: proposeResult })

            if (!json) {
              spinner.succeed(
                `Created suggestion for ${chalk.bold(targetName)}: ${chalk.bold(proposeResult.title)}`
              )
              if (result.url) {
                console.log(chalk.dim(`  ${result.url}`))
              }
            } else {
              spinner.stop()
            }
          } catch (error) {
            const { message } = extractError(error, 'SUGGEST_FAILED')
            outcomes.push({ package: targetName, success: false, error: message })

            if (!json) {
              spinner.fail(`Failed to create suggestion for ${chalk.bold(targetName)}: ${message}`)
            } else {
              spinner.stop()
            }
          }
        }

        const succeeded = outcomes.filter((o) => o.success)
        const failed = outcomes.filter((o) => !o.success)

        if (json) {
          if (validTargets.length === 1) {
            const outcome = outcomes[0]!
            if (outcome.success) {
              outputSuccess<ProposeResult>(outcome.result!)
            } else {
              outputError('SUGGEST_FAILED', outcome.error!)
              process.exit(1)
            }
          } else {
            outputSuccess(outcomes)
          }
        } else if (validTargets.length > 1) {
          console.log()
          console.log(
            chalk.bold(
              `Created ${succeeded.length} suggestion${succeeded.length === 1 ? '' : 's'}` +
                (failed.length > 0 ? ` (${failed.length} failed)` : '')
            )
          )
        }

        if (failed.length > 0 && succeeded.length === 0 && !json) {
          process.exit(1)
        }
      }
    )
}
