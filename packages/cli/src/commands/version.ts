import type { VersionCreateResult, VersionListEntry, VersionListResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { platformFetch } from '../registry/platform.js'
import { readLockfile } from '../storage/lockfile.js'
import {
  getTrackedSourceCommit,
  isPlatformManagedSource,
  resolvePackageQuery,
} from '../storage/package-identity.js'
import { extractError, SEMVER_REGEX } from '../utils.js'
import { resolveCurrentSkillIdentity } from './skill-context.js'

type VersionCreateResponse = {
  tag: string
  commitSha: string
}

type VersionListOptions = {
  json?: boolean
}

type VersionCreateOptions = {
  notes?: string
  json?: boolean
}

type VersionApiRecord = {
  version?: string
  changelog?: string | null
  gitRef?: string | null
  gitCommitSha?: string | null
}

type VersionListResponse =
  | VersionListEntry[]
  | { versions: Array<VersionListEntry | VersionApiRecord> }

function normaliseVersionEntry(version: VersionListEntry | VersionApiRecord): VersionListEntry {
  if ('tag' in version && 'commitSha' in version && 'message' in version) {
    return version
  }

  const resolvedVersion = version.version ?? 'unknown'
  const tag = version.gitRef ?? `v/${resolvedVersion}`
  return {
    name: tag,
    tag,
    commitSha: version.gitCommitSha ?? 'unknown',
    message: version.changelog ?? '',
  }
}

function normaliseVersions(response: VersionListResponse): VersionListEntry[] {
  const versions = Array.isArray(response) ? response : response.versions
  return versions.map(normaliseVersionEntry)
}

async function listVersions(options: VersionListOptions): Promise<void> {
  const jsonMode = isJSONMode() || options.json === true

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

  const spinner = createSpinner('Fetching versions...').start()

  try {
    const response = await platformFetch<VersionListResponse>(
      `/skills/@${identity.org}/${identity.name}/versions`
    )
    const versions = normaliseVersions(response)

    spinner.stop()

    if (jsonMode) {
      outputSuccess<VersionListResult>({ versions })
      return
    }

    if (versions.length === 0) {
      process.stdout.write(chalk.dim('No versions found.\n'))
      return
    }

    process.stdout.write(chalk.bold(`\nVersions for @${identity.org}/${identity.name}:\n\n`))

    for (const v of versions) {
      process.stdout.write(
        `  ${chalk.cyan(v.name)} ${chalk.dim(`(${v.commitSha.slice(0, 7)})`)} ${chalk.dim(v.message)}\n`
      )
    }

    process.stdout.write('\n')
  } catch (error) {
    const { message } = extractError(error, 'VERSION_FAILED')
    if (jsonMode) {
      spinner.stop()
      outputError('VERSION_FAILED', message)
    } else {
      spinner.fail(`Failed to list versions: ${message}`)
    }
    process.exit(1)
  }
}

export function registerVersionCommand(program: Command): void {
  const version = program.command('version').description('Manage skill versions (tags)')

  // --- version create <semver> ---
  version
    .command('create <semver>')
    .description('Create a version tag for the current skill')
    .option('--notes <text>', 'Release notes')
    .option('--json', 'Output as JSON')
    .action(async (semver: string, options: VersionCreateOptions) => {
      const jsonMode = isJSONMode() || options.json === true

      if (!SEMVER_REGEX.test(semver)) {
        const message = `Invalid semver "${semver}". Expected format: 1.0.0, 1.0.0-beta.1, or 1.0.0+build.42`
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

      // Get the current commit SHA from lockfile
      const lockfile = readLockfile(process.cwd())
      const lockEntryLookup = resolvePackageQuery(lockfile.packages, identity.name)
      const lockEntry = lockEntryLookup.ok ? lockEntryLookup.pkg : undefined
      const commitSha =
        lockEntry && isPlatformManagedSource(lockEntry.source)
          ? getTrackedSourceCommit(lockEntry.source)
          : undefined

      if (!commitSha || commitSha === 'unknown') {
        const message = 'No commit SHA found in lockfile. Save changes first.'
        if (jsonMode) {
          outputError('NOT_FOUND', message)
        } else {
          process.stderr.write(chalk.red(`${message}\n`))
        }
        process.exit(1)
      }

      const spinner = createSpinner(`Creating version ${semver}...`).start()

      try {
        const result = await platformFetch<VersionCreateResponse>(
          `/skills/@${identity.org}/${identity.name}/versions`,
          {
            method: 'POST',
            body: {
              version: semver,
              notes: options.notes,
              commitSha,
            },
          }
        )

        if (jsonMode) {
          spinner.stop()
          outputSuccess<VersionCreateResult>({
            skill: `@${identity.org}/${identity.name}`,
            version: semver,
            tag: result.tag,
            commitSha: result.commitSha,
          })
        } else {
          spinner.succeed(
            `Version ${chalk.cyan(semver)} created ${chalk.dim(`(${result.commitSha.slice(0, 7)})`)}`
          )
        }
      } catch (error) {
        const { message } = extractError(error, 'VERSION_FAILED')
        if (jsonMode) {
          spinner.stop()
          outputError('VERSION_FAILED', message)
        } else {
          spinner.fail(`Failed to create version: ${message}`)
        }
        process.exit(1)
      }
    })

  // --- version list ---
  version
    .command('list')
    .description('List versions for the current skill')
    .option('--json', 'Output as JSON')
    .action(listVersions)

  program
    .command('versions')
    .description('List published versions for the current skill')
    .option('--json', 'Output as JSON')
    .action(listVersions)
}
