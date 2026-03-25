import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import type { SyncResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { getCredentials } from '../registry/auth.js'
import { getPlatformUrl } from '../registry/config.js'
import { readManifest } from '../storage/manifest.js'
import { extractError } from '../utils.js'

const SYNC_TIMEOUT_MS = 30_000

type SyncGitSource = {
  type: 'git'
  uri: string
  path: string
  ref: string
  commit: string
}

type SyncWellKnownSource = {
  type: 'well-known'
  baseUrl: string
  hostname: string
  skillName: string
}

type SyncPackageEntry = {
  source: SyncGitSource | SyncWellKnownSource
  agents: string[]
  modified: boolean
}

type SyncResponse = {
  synced: number
  removed: number
}

function getMachineId(): string {
  return createHash('sha256').update(hostname()).digest('hex')
}

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Push local installation state to platform (requires platform connection)')
    .action(async () => {
      const platformUrl = getPlatformUrl()
      if (!platformUrl) {
        if (isJSONMode()) {
          outputError(
            'AUTH_REQUIRED',
            'Not connected to a platform. Run `agentver login <url>` first.'
          )
          process.exit(1)
        }
        console.error(
          chalk.red('Not connected to a platform.') +
            ' Run ' +
            chalk.cyan('`agentver login <url>`') +
            ' first.'
        )
        process.exit(1)
      }

      const creds = await getCredentials()
      if (!creds?.token && !creds?.apiKey) {
        if (isJSONMode()) {
          outputError(
            'AUTH_REQUIRED',
            'Not connected to a platform. Run `agentver login <url>` first.'
          )
          process.exit(1)
        }
        console.error(
          chalk.red('Not connected to a platform.') +
            ' Run ' +
            chalk.cyan('`agentver login <url>`') +
            ' first.'
        )
        process.exit(1)
      }

      const projectRoot = process.cwd()
      const manifest = readManifest(projectRoot)
      const packageEntries = Object.entries(manifest.packages)

      const spinner = createSpinner('Syncing installation state to platform...').start()

      const packageNames = packageEntries.map(([name]) => name)
      const packages: Record<string, SyncPackageEntry> = {}

      for (const [name, pkg] of packageEntries) {
        const source: SyncGitSource | SyncWellKnownSource =
          pkg.source.type === 'git'
            ? {
                type: 'git',
                uri: pkg.source.uri,
                path: pkg.source.path,
                ref: pkg.source.ref,
                commit: pkg.source.commit,
              }
            : {
                type: 'well-known',
                baseUrl: pkg.source.baseUrl,
                hostname: pkg.source.hostname,
                skillName: pkg.source.skillName,
              }

        packages[name] = {
          source,
          agents: pkg.agents,
          modified: pkg.modified,
        }
      }

      const machineId = getMachineId()

      const authHeaders: Record<string, string> = {}
      if (creds.token) {
        authHeaders.Authorization = `Bearer ${creds.token}`
      } else if (creds.apiKey) {
        authHeaders['X-API-Key'] = creds.apiKey
      }

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS)

        const response = await fetch(`${platformUrl}/api/v1/installations/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify({
            machineId,
            packages,
          }),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error')
          if (isJSONMode()) {
            spinner.stop()
            outputError('SYNC_FAILED', `Sync failed (${response.status}): ${errorText}`)
          } else {
            spinner.fail(`Sync failed (${response.status}): ${errorText}`)
          }
          process.exit(1)
        }

        const result = (await response.json()) as SyncResponse

        if (isJSONMode()) {
          outputSuccess<SyncResult>({
            synced: result.synced,
            machineId,
            packages: packageNames,
          })
          return
        }

        spinner.succeed(
          `Synced ${chalk.green(String(result.synced))} skill${result.synced === 1 ? '' : 's'} to platform` +
            (result.removed > 0 ? chalk.dim(` (${result.removed} removed)`) : '')
        )
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          if (isJSONMode()) {
            spinner.stop()
            outputError('TIMEOUT', 'Sync timed out. The platform may be experiencing issues.')
          } else {
            spinner.fail('Sync timed out. The platform may be experiencing issues.')
          }
        } else {
          const { code, message } = extractError(error, 'SYNC_FAILED')
          if (isJSONMode()) {
            spinner.stop()
            outputError(code, message)
          } else {
            spinner.fail(`Sync failed: ${message}`)
          }
        }
        process.exit(1)
      }
    })
}
