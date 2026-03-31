import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SyncResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { getCredentials } from '../registry/auth.js'
import { getPlatformUrl } from '../registry/config.js'
import { ensureStorageDir, getStorageRoot } from '../storage/files.js'
import { readInstalledPackageFiles } from '../storage/installed-package-files.js'
import { computeSha256FromFiles } from '../storage/integrity.js'
import { readLockfile } from '../storage/lockfile.js'
import { readManifest } from '../storage/manifest.js'
import type { Scope } from '../utils/paths'
import { extractError } from '../utils.js'

const SYNC_TIMEOUT_MS = 30_000
const MACHINE_ID_FILE = 'machine-id'

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

type SyncOptions = {
  global?: boolean
  json?: boolean
}

function getMachineId(projectRoot: string): string {
  ensureStorageDir(projectRoot, 'global')
  const storageRoot = getStorageRoot(projectRoot, 'global')
  const machineIdPath = join(storageRoot, MACHINE_ID_FILE)

  if (existsSync(machineIdPath)) {
    const existing = readFileSync(machineIdPath, 'utf-8').trim()
    if (existing) {
      return existing
    }
  }

  const machineId = randomUUID()
  writeFileSync(machineIdPath, machineId, 'utf-8')
  return machineId
}

async function isLocallyModified(
  projectRoot: string,
  scope: Scope,
  name: string,
  pkg: ReturnType<typeof readManifest>['packages'][string],
  lockEntry: ReturnType<typeof readLockfile>['packages'][string] | undefined
): Promise<boolean> {
  if (!lockEntry?.integrity) {
    return false
  }

  try {
    const localFiles = await readInstalledPackageFiles(projectRoot, name, pkg.agents, {
      scope,
      packageType: pkg.packageType,
      entryFile: pkg.entryFile,
    })

    if (localFiles.length === 0) {
      return false
    }

    return computeSha256FromFiles(localFiles) !== lockEntry.integrity
  } catch {
    return false
  }
}

function toSyncSource(
  pkg: ReturnType<typeof readManifest>['packages'][string]
): SyncGitSource | SyncWellKnownSource {
  if (pkg.source.type === 'git') {
    return {
      type: 'git',
      uri: pkg.source.uri,
      path: pkg.source.path,
      ref: pkg.source.ref,
      commit: pkg.source.commit,
    }
  }

  return {
    type: 'well-known',
    baseUrl: pkg.source.baseUrl,
    hostname: pkg.source.hostname,
    skillName: pkg.source.skillName,
  }
}

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Push local installation state to platform (requires platform connection)')
    .option('--global', 'Sync globally installed packages')
    .option('--json', 'Output as JSON')
    .action(async (options: SyncOptions) => {
      const jsonMode = isJSONMode() || options.json === true
      const scope: Scope = options.global ? 'global' : 'project'
      const platformUrl = getPlatformUrl()

      if (!platformUrl) {
        if (jsonMode) {
          outputError(
            'AUTH_REQUIRED',
            'Not connected to a platform. Run `agentver login <url>` first.'
          )
        } else {
          console.error(
            chalk.red('Not connected to a platform.') +
              ' Run ' +
              chalk.cyan('`agentver login <url>`') +
              ' first.'
          )
        }
        process.exit(1)
        return
      }

      const creds = await getCredentials()
      if (!creds?.token && !creds?.apiKey) {
        if (jsonMode) {
          outputError(
            'AUTH_REQUIRED',
            'Not connected to a platform. Run `agentver login <url>` first.'
          )
        } else {
          console.error(
            chalk.red('Not connected to a platform.') +
              ' Run ' +
              chalk.cyan('`agentver login <url>`') +
              ' first.'
          )
        }
        process.exit(1)
        return
      }

      const projectRoot = process.cwd()
      const manifest = readManifest(projectRoot, scope)
      const lockfile = readLockfile(projectRoot, scope)
      const packageEntries = Object.entries(manifest.packages)

      const spinner = createSpinner('Syncing installation state to platform...').start()

      const packageNames = packageEntries.map(([name]) => name)
      const packages = Object.fromEntries(
        await Promise.all(
          packageEntries.map(async ([name, pkg]) => {
            const modified = await isLocallyModified(
              projectRoot,
              scope,
              name,
              pkg,
              lockfile.packages[name]
            )

            return [
              name,
              {
                source: toSyncSource(pkg),
                agents: pkg.agents,
                modified,
              } satisfies SyncPackageEntry,
            ]
          })
        )
      ) as Record<string, SyncPackageEntry>

      const machineId = getMachineId(projectRoot)

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
          if (jsonMode) {
            spinner.stop()
            outputError('SYNC_FAILED', `Sync failed (${response.status}): ${errorText}`)
          } else {
            spinner.fail(`Sync failed (${response.status}): ${errorText}`)
          }
          process.exit(1)
          return
        }

        const result = (await response.json()) as SyncResponse

        if (jsonMode) {
          outputSuccess<SyncResult>({
            synced: result.synced,
            machineId,
            packages: packageNames,
          })
          return
        }

        spinner.succeed(
          `Synced ${chalk.green(String(result.synced))} skill${result.synced === 1 ? '' : 's'} to platform` +
            (result.removed > 0 ? chalk.dim(` (${result.removed} removed)`) : '') +
            chalk.dim(scope === 'global' ? ' [global]' : ' [project]')
        )
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          if (jsonMode) {
            spinner.stop()
            outputError('TIMEOUT', 'Sync timed out. The platform may be experiencing issues.')
          } else {
            spinner.fail('Sync timed out. The platform may be experiencing issues.')
          }
        } else {
          const { code, message } = extractError(error, 'SYNC_FAILED')
          if (jsonMode) {
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
