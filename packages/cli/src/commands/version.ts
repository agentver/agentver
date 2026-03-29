import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import ora from 'ora'
import { platformFetch } from '../registry/platform.js'
import { readLockfile } from '../storage/lockfile.js'
import { readManifest } from '../storage/manifest.js'
import { extractError, SEMVER_REGEX } from '../utils.js'
import { extractOrgFromUri } from '../utils/uri.js'

type VersionInfo = {
  name: string
  tag: string
  commitSha: string
  message: string
}

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

/**
 * Resolve the skill identity from the current directory and manifest.
 */
function resolveSkillIdentity(): { org: string; name: string } | null {
  const cwd = process.cwd()
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

  const manifest = readManifest(cwd)
  const entry = manifest.packages[skillName]

  if (entry?.source.type === 'git') {
    const org = extractOrgFromUri(entry.source.uri)
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

export function registerVersionCommand(program: Command): void {
  const version = program.command('version').description('Manage skill versions (tags)')

  // --- version create <semver> ---
  version
    .command('create <semver>')
    .description('Create a version tag for the current skill')
    .option('--notes <text>', 'Release notes')
    .option('--json', 'Output as JSON')
    .action(async (semver: string, options: VersionCreateOptions) => {
      if (!SEMVER_REGEX.test(semver)) {
        process.stderr.write(
          chalk.red(`Invalid semver "${semver}". Expected format: 1.0.0 or 1.0.0-beta.1\n`)
        )
        process.exit(1)
      }

      const identity = resolveSkillIdentity()
      if (!identity) {
        process.stderr.write(
          chalk.red('Could not determine skill identity. Run this from a skill directory.\n')
        )
        process.exit(1)
      }

      // Get the current commit SHA from lockfile
      const lockfile = readLockfile(process.cwd())
      const lockEntry = lockfile.packages[identity.name]
      const commitSha = lockEntry?.source.type === 'git' ? lockEntry.source.commit : undefined

      if (!commitSha || commitSha === 'unknown') {
        process.stderr.write(chalk.red('No commit SHA found in lockfile. Save changes first.\n'))
        process.exit(1)
      }

      const spinner = ora(`Creating version ${semver}...`).start()

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

        if (options.json) {
          spinner.stop()
          console.log(
            JSON.stringify(
              {
                skill: `@${identity.org}/${identity.name}`,
                version: semver,
                tag: result.tag,
                commitSha: result.commitSha,
              },
              null,
              2
            )
          )
        } else {
          spinner.succeed(
            `Version ${chalk.cyan(semver)} created ${chalk.dim(`(${result.commitSha.slice(0, 7)})`)}`
          )
        }
      } catch (error) {
        const { message } = extractError(error, 'VERSION_FAILED')
        spinner.fail(`Failed to create version: ${message}`)
        process.exit(1)
      }
    })

  // --- version list ---
  version
    .command('list')
    .description('List versions for the current skill')
    .option('--json', 'Output as JSON')
    .action(async (options: VersionListOptions) => {
      const identity = resolveSkillIdentity()
      if (!identity) {
        process.stderr.write(
          chalk.red('Could not determine skill identity. Run this from a skill directory.\n')
        )
        process.exit(1)
      }

      const spinner = ora('Fetching versions...').start()

      try {
        const versions = await platformFetch<VersionInfo[]>(
          `/skills/@${identity.org}/${identity.name}/versions`
        )

        spinner.stop()

        if (options.json) {
          console.log(JSON.stringify({ versions }, null, 2))
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
        spinner.fail(`Failed to list versions: ${message}`)
        process.exit(1)
      }
    })
}
