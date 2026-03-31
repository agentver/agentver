import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import { readFilesFromDirectory } from '../git/fetcher.js'
import type { GitSource } from '../git/types.js'
import { createSpinner, outputSuccess } from '../output.js'
import { platformFetch } from '../registry/platform.js'
import { scanFiles } from '../security/index.js'
import { readLockfile } from '../storage/lockfile.js'
import { updateManifestAndLockfile } from '../storage/pair.js'
import { detectSkillName, resolveNamespace } from './skill-context.js'

type SaveOptions = {
  path?: string
  dryRun?: boolean
  skipAudit?: boolean
  json?: boolean
}

type SaveResponse = {
  commitSha: string
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

export function registerSaveCommand(program: Command): void {
  program
    .command('save [message]')
    .description('Commit local skill changes to the platform')
    .option('--path <path>', 'Path to skill directory')
    .option('--dry-run', 'Show what would be saved without committing')
    .option('--skip-audit', 'Skip security scan')
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
      const namespace = resolveNamespace({
        projectRoot,
        skillDir,
        skillName,
      })

      if (!namespace) {
        process.stderr.write(
          chalk.red(
            `Skill "${skillName}" not found in manifest. Install it first or check the directory.\n`
          )
        )
        process.exit(1)
      }

      const spinner = createSpinner('Reading local files...').start()
      const lockfile = readLockfile(projectRoot)
      const currentRef =
        lockfile.packages[skillName]?.source.type === 'git'
          ? lockfile.packages[skillName].source.ref
          : undefined

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

        if (!options.skipAudit) {
          spinner.text = 'Running security audit...'

          const scanSource: GitSource = {
            host: 'local',
            owner: namespace.org,
            repo: namespace.name,
            path: '',
            ref: currentRef ?? 'main',
          }

          const scanResult = await scanFiles(localFiles, scanSource, {
            skipAudit: false,
          })

          if (scanResult.verdict === 'BLOCK') {
            spinner.fail('Security audit failed. Fix the issues before saving.')
            for (const finding of scanResult.findings) {
              process.stderr.write(
                `  ${chalk.red('BLOCK')} ${finding.file}:${String(finding.line ?? '?')} — ${finding.message}\n`
              )
            }
            process.exit(1)
          }

          if (scanResult.verdict === 'WARN') {
            spinner.warn('Security audit warnings found:')
            for (const finding of scanResult.findings) {
              process.stderr.write(
                `  ${chalk.yellow('WARN')} ${finding.file}:${String(finding.line ?? '?')} — ${finding.message}\n`
              )
            }
            spinner.start('Continuing...')
          }
        }

        if (options.dryRun) {
          spinner.stop()

          if (options.json) {
            outputSuccess({
              dryRun: true,
              skill: `@${namespace.org}/${namespace.name}`,
              message: commitMessage,
              files: filesToSave.map((f) => f.path),
            })
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
              ...(currentRef ? { ref: currentRef } : {}),
            },
          }
        )

        updateManifestAndLockfile(projectRoot, 'project', (manifest, currentLockfile) => {
          const manifestEntry = manifest.packages[skillName]
          if (manifestEntry?.source.type === 'git') {
            manifestEntry.source.commit = result.commitSha
            if (currentRef) {
              manifestEntry.source.ref = currentRef
            }
          }

          const lockEntry = currentLockfile.packages[skillName]
          if (lockEntry?.source.type === 'git') {
            lockEntry.source.commit = result.commitSha
            if (currentRef) {
              lockEntry.source.ref = currentRef
            }
          }

          return {
            manifest,
            lockfile: currentLockfile,
          }
        })

        if (options.json) {
          outputSuccess({
            skill: `@${namespace.org}/${namespace.name}`,
            commitSha: result.commitSha,
            files: filesToSave.map((f) => f.path),
          })
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
