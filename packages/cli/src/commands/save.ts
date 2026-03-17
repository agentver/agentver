import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import ora from 'ora'
import { readFilesFromDirectory } from '../git/fetcher.js'
import { platformFetch } from '../registry/platform.js'
import { readLockfile, writeLockfile } from '../storage/lockfile.js'
import { readManifest } from '../storage/manifest.js'

type SaveOptions = {
  path?: string
  dryRun?: boolean
  json?: boolean
}

type SaveResponse = {
  commitSha: string
}

/**
 * Detect a skill name from the current directory by looking for a SKILL.md
 * frontmatter `name:` field, or falling back to the directory basename.
 */
function detectSkillName(skillDir: string): string | null {
  const skillMdPath = join(skillDir, 'SKILL.md')
  if (!existsSync(skillMdPath)) {
    return null
  }

  const content = readFileSync(skillMdPath, 'utf-8')
  const nameMatch = content.match(/^name:\s*(.+)$/m)
  return nameMatch?.[1]?.trim() ?? basename(skillDir)
}

/**
 * Resolve the skill directory and name from options or the current directory.
 */
function resolveSkillContext(options: SaveOptions): { skillDir: string; skillName: string } | null {
  const skillDir = options.path ? resolve(process.cwd(), options.path) : process.cwd()

  if (!existsSync(skillDir)) {
    return null
  }

  const skillName = detectSkillName(skillDir)
  if (!skillName) {
    return null
  }

  return { skillDir, skillName }
}

/**
 * Find the org/namespace for a skill by checking the manifest source.
 */
function findNamespace(
  projectRoot: string,
  skillName: string
): { org: string; name: string } | null {
  const manifest = readManifest(projectRoot)
  const entry = manifest.packages[skillName]

  if (!entry || entry.source.type !== 'git') {
    return null
  }

  // Source URI format: host/org/repo or just org from platform
  const parts = entry.source.uri.split('/')
  // The org is typically the second segment (host/org/repo)
  const org = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
  if (!org) return null

  return { org, name: skillName }
}

export function registerSaveCommand(program: Command): void {
  program
    .command('save [message]')
    .description('Commit local skill changes to the platform')
    .option('--path <path>', 'Path to skill directory')
    .option('--dry-run', 'Show what would be saved without committing')
    .option('--json', 'Output as JSON')
    .action(async (message: string | undefined, options: SaveOptions) => {
      const context = resolveSkillContext(options)

      if (!context) {
        const target = options.path ?? process.cwd()
        process.stderr.write(
          chalk.red(`No SKILL.md found in ${target}. Run this from a skill directory.\n`)
        )
        process.exit(1)
      }

      const { skillDir, skillName } = context
      const projectRoot = process.cwd()
      const namespace = findNamespace(projectRoot, skillName)

      if (!namespace) {
        process.stderr.write(
          chalk.red(
            `Skill "${skillName}" not found in manifest. Install it first or check the directory.\n`
          )
        )
        process.exit(1)
      }

      const spinner = ora('Reading local files...').start()

      try {
        const localFiles = await readFilesFromDirectory(skillDir)

        if (localFiles.length === 0) {
          spinner.fail('No files found in skill directory.')
          process.exit(1)
        }

        const filesToSave = localFiles.map((f) => ({
          path: f.path,
          content: f.content,
        }))

        const commitMessage = message ?? `Update skill: ${skillName}`

        if (options.dryRun) {
          spinner.stop()

          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  dryRun: true,
                  skill: `@${namespace.org}/${namespace.name}`,
                  message: commitMessage,
                  files: filesToSave.map((f) => f.path),
                },
                null,
                2
              )
            )
          } else {
            process.stdout.write(
              chalk.yellow('[dry-run]') +
                ` Would save ${chalk.green(skillName)} to @${namespace.org}/${namespace.name}\n`
            )
            process.stdout.write(chalk.dim(`  Message: ${commitMessage}\n`))
            process.stdout.write(
              chalk.dim(`  Files: ${filesToSave.map((f) => f.path).join(', ')}\n`)
            )
          }
          return
        }

        spinner.text = `Saving ${filesToSave.length} file(s) to platform...`

        const result = await platformFetch<SaveResponse>(
          `/skills/@${namespace.org}/${namespace.name}/save`,
          {
            method: 'POST',
            body: {
              message: commitMessage,
              files: filesToSave,
            },
          }
        )

        // Update the lockfile with the new commit SHA
        const lockfile = readLockfile(projectRoot)
        const lockEntry = lockfile.packages[skillName]
        if (lockEntry?.source.type === 'git') {
          lockEntry.source.commit = result.commitSha
          writeLockfile(projectRoot, lockfile)
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                skill: `@${namespace.org}/${namespace.name}`,
                commitSha: result.commitSha,
                files: filesToSave.map((f) => f.path),
              },
              null,
              2
            )
          )
        } else {
          spinner.succeed(
            `Saved ${chalk.green(skillName)} ${chalk.dim(`(${result.commitSha.slice(0, 7)})`)}`
          )
        }
      } catch (error) {
        spinner.fail(`Failed to save: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
    })
}
