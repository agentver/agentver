import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, outputSuccess } from '../output.js'
import { platformFetch } from '../registry/platform.js'
import { readLockfile, writeLockfile } from '../storage/lockfile.js'
import { readManifest } from '../storage/manifest.js'

type DraftInfo = {
  name: string
  branchName: string
  latestCommitId: string
  latestMessage: string
}

type DraftCreateResponse = {
  name: string
  branchName: string
}

type DraftActionResponse = {
  commitSha?: string
}

type DraftListOptions = {
  json?: boolean
}

/**
 * Resolve the skill name and namespace from the current directory or manifest.
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
    const parts = entry.source.uri.split('/')
    const org = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
    if (org) {
      return { org, name: skillName }
    }
  }

  // Fallback: try directory structure
  const pathParts = cwd.split('/')
  const skillsIdx = pathParts.lastIndexOf('skills')
  if (skillsIdx >= 0 && pathParts.length > skillsIdx + 2) {
    return { org: pathParts[skillsIdx + 1]!, name: skillName }
  }

  return null
}

export function registerDraftCommand(program: Command): void {
  const draft = program.command('draft').description('Manage skill drafts (branches)')

  // --- draft create <name> ---
  draft
    .command('create <name>')
    .description('Create a draft branch for the current skill')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: DraftListOptions) => {
      const identity = resolveSkillIdentity()
      if (!identity) {
        process.stderr.write(
          chalk.red('Could not determine skill identity. Run this from a skill directory.\n')
        )
        process.exit(1)
      }

      const spinner = createSpinner(`Creating draft "${name}"...`).start()

      try {
        const result = await platformFetch<DraftCreateResponse>(
          `/skills/@${identity.org}/${identity.name}/drafts`,
          {
            method: 'POST',
            body: { name },
          }
        )

        if (options.json) {
          spinner.stop()
          outputSuccess(result)
        } else {
          spinner.succeed(
            `Draft ${chalk.green(result.name)} created on branch ${chalk.cyan(result.branchName)}`
          )
        }
      } catch (error) {
        spinner.fail(
          `Failed to create draft: ${error instanceof Error ? error.message : String(error)}`
        )
        process.exit(1)
      }
    })

  // --- draft list ---
  draft
    .command('list')
    .description('List open drafts for the current skill')
    .option('--json', 'Output as JSON')
    .action(async (options: DraftListOptions) => {
      const identity = resolveSkillIdentity()
      if (!identity) {
        process.stderr.write(
          chalk.red('Could not determine skill identity. Run this from a skill directory.\n')
        )
        process.exit(1)
      }

      const spinner = createSpinner('Fetching drafts...').start()

      try {
        const drafts = await platformFetch<DraftInfo[]>(
          `/skills/@${identity.org}/${identity.name}/drafts`
        )

        spinner.stop()

        if (options.json) {
          outputSuccess({ drafts })
          return
        }

        if (drafts.length === 0) {
          process.stdout.write(chalk.dim('No open drafts.\n'))
          return
        }

        process.stdout.write(chalk.bold(`\nDrafts for @${identity.org}/${identity.name}:\n\n`))

        for (const d of drafts) {
          process.stdout.write(
            `  ${chalk.green(d.name)} ${chalk.dim(`(${d.latestCommitId.slice(0, 7)})`)} ${chalk.dim(d.latestMessage)}\n`
          )
        }

        process.stdout.write('\n')
      } catch (error) {
        spinner.fail(
          `Failed to list drafts: ${error instanceof Error ? error.message : String(error)}`
        )
        process.exit(1)
      }
    })

  // --- draft switch <name> ---
  draft
    .command('switch <name>')
    .description('Switch to a draft branch (updates lockfile ref)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: DraftListOptions) => {
      const identity = resolveSkillIdentity()
      if (!identity) {
        process.stderr.write(
          chalk.red('Could not determine skill identity. Run this from a skill directory.\n')
        )
        process.exit(1)
      }

      const projectRoot = process.cwd()
      const lockfile = readLockfile(projectRoot)
      const lockEntry = lockfile.packages[identity.name]

      if (!lockEntry) {
        process.stderr.write(chalk.red(`Skill "${identity.name}" not found in lockfile.\n`))
        process.exit(1)
      }

      if (lockEntry.source.type === 'git') {
        lockEntry.source.ref = `draft/${identity.name}/${name}`
        writeLockfile(projectRoot, lockfile)
      }

      if (options.json) {
        outputSuccess({
          skill: `@${identity.org}/${identity.name}`,
          draft: name,
          ref: `draft/${identity.name}/${name}`,
        })
      } else {
        process.stdout.write(
          `Switched to draft ${chalk.green(name)} ${chalk.dim(`(ref: draft/${identity.name}/${name})`)}\n`
        )
      }
    })

  // --- draft publish ---
  draft
    .command('publish')
    .description('Merge current draft to main')
    .option('--json', 'Output as JSON')
    .action(async (options: DraftListOptions) => {
      const identity = resolveSkillIdentity()
      if (!identity) {
        process.stderr.write(
          chalk.red('Could not determine skill identity. Run this from a skill directory.\n')
        )
        process.exit(1)
      }

      // Determine current draft from lockfile ref
      const projectRoot = process.cwd()
      const lockfile = readLockfile(projectRoot)
      const lockEntry = lockfile.packages[identity.name]

      if (!lockEntry || lockEntry.source.type !== 'git') {
        process.stderr.write(chalk.red('Skill not found in lockfile.\n'))
        process.exit(1)
      }

      const currentRef = lockEntry.source.ref
      if (!currentRef.startsWith('draft/')) {
        process.stderr.write(chalk.red(`Not on a draft branch. Current ref: ${currentRef}\n`))
        process.exit(1)
      }

      const spinner = createSpinner('Merging draft to main...').start()

      try {
        const result = await platformFetch<DraftActionResponse>(
          `/skills/@${identity.org}/${identity.name}/drafts`,
          {
            method: 'POST',
            body: { action: 'merge', branchName: currentRef },
          }
        )

        // Update lockfile back to main
        lockEntry.source.ref = 'main'
        if (result.commitSha) {
          lockEntry.source.commit = result.commitSha
        }
        writeLockfile(projectRoot, lockfile)

        if (options.json) {
          spinner.stop()
          outputSuccess({
            merged: true,
            commitSha: result.commitSha,
            ref: 'main',
          })
        } else {
          spinner.succeed(
            `Draft merged to main ${result.commitSha ? chalk.dim(`(${result.commitSha.slice(0, 7)})`) : ''}`
          )
        }
      } catch (error) {
        spinner.fail(
          `Failed to merge draft: ${error instanceof Error ? error.message : String(error)}`
        )
        process.exit(1)
      }
    })

  // --- draft discard ---
  draft
    .command('discard')
    .description('Delete the current draft branch')
    .option('--json', 'Output as JSON')
    .action(async (options: DraftListOptions) => {
      const identity = resolveSkillIdentity()
      if (!identity) {
        process.stderr.write(
          chalk.red('Could not determine skill identity. Run this from a skill directory.\n')
        )
        process.exit(1)
      }

      const projectRoot = process.cwd()
      const lockfile = readLockfile(projectRoot)
      const lockEntry = lockfile.packages[identity.name]

      if (!lockEntry || lockEntry.source.type !== 'git') {
        process.stderr.write(chalk.red('Skill not found in lockfile.\n'))
        process.exit(1)
      }

      const currentRef = lockEntry.source.ref
      if (!currentRef.startsWith('draft/')) {
        process.stderr.write(chalk.red(`Not on a draft branch. Current ref: ${currentRef}\n`))
        process.exit(1)
      }

      const spinner = createSpinner('Discarding draft...').start()

      try {
        await platformFetch<DraftActionResponse>(
          `/skills/@${identity.org}/${identity.name}/drafts`,
          {
            method: 'POST',
            body: { action: 'delete', branchName: currentRef },
          }
        )

        // Reset lockfile ref to main
        lockEntry.source.ref = 'main'
        writeLockfile(projectRoot, lockfile)

        if (options.json) {
          spinner.stop()
          outputSuccess({
            discarded: true,
            previousRef: currentRef,
            ref: 'main',
          })
        } else {
          spinner.succeed(`Draft discarded. Switched back to ${chalk.cyan('main')}.`)
        }
      } catch (error) {
        spinner.fail(
          `Failed to discard draft: ${error instanceof Error ? error.message : String(error)}`
        )
        process.exit(1)
      }
    })
}
