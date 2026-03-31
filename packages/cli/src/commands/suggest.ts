import type { ManifestV2Package, ProposeResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { getCredentials } from '../registry/auth.js'
import { getPlatformUrl } from '../registry/config.js'
import { platformFetch } from '../registry/platform.js'
import { readInstalledPackageFiles } from '../storage/installed-package-files.js'
import { computeSha256FromFiles } from '../storage/integrity.js'
import { readLockfile } from '../storage/lockfile.js'
import { readManifest } from '../storage/manifest.js'
import { getDisplayName, resolvePackageQuery } from '../storage/package-identity.js'
import { extractError } from '../utils.js'

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
  const localFiles = await readInstalledPackageFiles(projectRoot, packageName, manifestEntry.agents)

  if (localFiles.length === 0) {
    throw new Error(`No local files found for "${packageName}".`)
  }

  const endpoint = buildEndpoint(manifestEntry, packageName)

  const requestBody: SuggestionRequest = {
    title,
    description,
    files: localFiles,
  }

  const result = await platformFetch<SuggestionResponse>(endpoint, {
    method: 'POST',
    body: requestBody,
  })
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

        for (const [packageKey, manifestEntry] of Object.entries(manifest.packages)) {
          const lockfileEntry = lockfile.packages[packageKey]
          if (!lockfileEntry) continue

          const displayName = getDisplayName(packageKey, manifestEntry)
          const { agents } = manifestEntry
          const localFiles = await readInstalledPackageFiles(projectRoot, displayName, agents)
          if (localFiles.length === 0) continue

          const currentIntegrity = computeSha256FromFiles(localFiles)
          if (currentIntegrity !== lockfileEntry.integrity) {
            modifiedPackages.push(packageKey)
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

        const targets = (() => {
          if (!options.name) {
            return modifiedPackages
          }

          const lookup = resolvePackageQuery(manifest.packages, options.name)
          return lookup.ok && modifiedPackages.includes(lookup.key) ? [lookup.key] : []
        })()

        if (targets.length === 0 && options.name) {
          const modifiedList = modifiedPackages
            .map((packageKey) => getDisplayName(packageKey, manifest.packages[packageKey]!))
            .join(', ')
          const message = `Package "${options.name}" is not in the modified list. Modified: ${modifiedList}`
          if (json) {
            outputError('NOT_FOUND', message)
            process.exit(1)
          }
          console.error(chalk.red(message))
          process.exit(1)
        }

        const unsupportedTargets = targets.filter(
          (packageKey) => manifest.packages[packageKey]?.source.type === 'well-known'
        )

        if (unsupportedTargets.length > 0) {
          for (const packageKey of unsupportedTargets) {
            const manifestEntry = manifest.packages[packageKey]
            if (!manifestEntry) {
              continue
            }

            const displayName = getDisplayName(packageKey, manifestEntry)
            const source = manifestEntry.source
            if (json) {
              outputError(
                'UNSUPPORTED_SOURCE',
                `Package "${displayName}" was installed from a well-known source. Suggestions are not supported.`
              )
            } else {
              console.error(
                chalk.red(
                  `Package "${displayName}" was installed from a well-known source (${source.type === 'well-known' ? source.hostname : 'unknown'}).`
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
            const displayName = getDisplayName(targetName, manifestEntry)
            const localFiles = await readInstalledPackageFiles(
              projectRoot,
              displayName,
              manifestEntry.agents
            )
            const endpoint = buildEndpoint(manifestEntry, displayName)

            dryRunResults.push({
              package: displayName,
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
          const displayName = getDisplayName(targetName, manifestEntry)
          const spinner = createSpinner(`Creating suggestion for ${displayName}...`).start()

          try {
            const { result } = await submitSuggestion(
              projectRoot,
              displayName,
              manifestEntry,
              title,
              options.description
            )

            const proposeResult: ProposeResult = {
              proposalId: result.id,
              title: result.title ?? title,
              url: result.url ?? '',
            }

            outcomes.push({ package: displayName, success: true, result: proposeResult })

            if (!json) {
              spinner.succeed(
                `Created suggestion for ${chalk.bold(displayName)}: ${chalk.bold(proposeResult.title)}`
              )
              if (result.url) {
                console.log(chalk.dim(`  ${result.url}`))
              }
            } else {
              spinner.stop()
            }
          } catch (error) {
            const { message } = extractError(error, 'SUGGEST_FAILED')
            outcomes.push({ package: displayName, success: false, error: message })

            if (!json) {
              spinner.fail(`Failed to create suggestion for ${chalk.bold(displayName)}: ${message}`)
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
