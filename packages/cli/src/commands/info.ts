import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { InfoResult } from '@agentver/shared'
import { parseSkillFrontmatter } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { readFilesFromDirectory } from '../git/fetcher.js'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { resolveReadPath } from '../storage/canonical.js'
import { computeSha256FromFiles } from '../storage/integrity.js'
import { readLockfile } from '../storage/lockfile.js'
import { readManifest } from '../storage/manifest.js'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function registerInfoCommand(program: Command): void {
  program
    .command('info <name>')
    .description('Show detailed information about an installed package')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: { json?: boolean }) => {
      const jsonMode = isJSONMode() || options.json === true
      const projectRoot = process.cwd()
      const manifest = readManifest(projectRoot)

      const pkg = manifest.packages[name]
      if (!pkg) {
        if (jsonMode) {
          outputError('NOT_FOUND', `Package "${name}" is not installed.`)
          process.exit(1)
        }
        console.error(chalk.red(`Package "${name}" is not installed.`))
        process.exit(1)
      }

      const spinner = createSpinner('Reading package information...').start()

      const lockfile = readLockfile(projectRoot)
      const lockfileEntry = lockfile.packages[name]
      const shortName = name.split('/').pop()!

      let fileCount = 0
      let totalSize = 0
      let locallyModified = false
      let skillTitle: string | undefined
      let skillDescription: string | undefined

      const readPath = resolveReadPath(projectRoot, shortName, pkg.agents)

      if (readPath) {
        try {
          const files = await readFilesFromDirectory(readPath)
          fileCount = files.length
          totalSize = files.reduce((sum, f) => sum + f.size, 0)

          if (lockfileEntry?.integrity && files.length > 0) {
            const localIntegrity = computeSha256FromFiles(files)
            locallyModified = localIntegrity !== lockfileEntry.integrity
          }

          const skillMdPath = join(readPath, 'SKILL.md')
          try {
            const skillMdContent = readFileSync(skillMdPath, 'utf-8')
            const { frontmatter } = parseSkillFrontmatter(skillMdContent)
            skillTitle = frontmatter.name
            skillDescription = frontmatter.description
          } catch {
            // No SKILL.md or invalid frontmatter — skip silently
          }
        } catch {
          // Unable to read files — continue with zero counts
        }
      }

      const sourceInfo =
        pkg.source.type === 'git'
          ? {
              type: 'git' as const,
              uri: pkg.source.uri,
              ref: pkg.source.ref,
              commit: pkg.source.commit,
            }
          : { type: 'well-known' as const, hostname: pkg.source.hostname }

      const result: InfoResult = {
        name,
        source: sourceInfo,
        agents: pkg.agents,
        installedAt: pkg.installedAt,
        modified: locallyModified,
        integrity: lockfileEntry?.integrity,
        files: {
          count: fileCount,
          totalSize,
        },
        skill:
          skillTitle && skillDescription
            ? { title: skillTitle, description: skillDescription }
            : undefined,
      }

      if (jsonMode) {
        spinner.stop()
        outputSuccess<InfoResult>(result)
        return
      }

      spinner.stop()

      console.log()
      console.log(chalk.bold(name))
      console.log()

      if (pkg.source.type === 'git') {
        console.log(`  ${chalk.dim('Source:')}    ${pkg.source.uri}`)
        console.log(`  ${chalk.dim('Ref:')}       ${chalk.cyan(pkg.source.ref)}`)
        console.log(`  ${chalk.dim('Commit:')}    ${chalk.dim(pkg.source.commit.slice(0, 7))}`)
      } else {
        console.log(
          `  ${chalk.dim('Source:')}    ${pkg.source.hostname} ${chalk.dim('[well-known]')}`
        )
      }

      console.log(
        `  ${chalk.dim('Agents:')}    ${pkg.agents.length > 0 ? pkg.agents.join(', ') : chalk.dim('none')}`
      )
      console.log(`  ${chalk.dim('Installed:')} ${pkg.installedAt}`)
      console.log(
        `  ${chalk.dim('Modified:')}  ${locallyModified ? chalk.yellow('yes') : chalk.green('no')}`
      )

      if (lockfileEntry?.integrity) {
        console.log(`  ${chalk.dim('Integrity:')} ${lockfileEntry.integrity}`)
      }

      console.log(
        `  ${chalk.dim('Files:')}     ${fileCount} file${fileCount !== 1 ? 's' : ''} (${formatBytes(totalSize)})`
      )

      if (skillTitle) {
        console.log()
        console.log(`  ${chalk.dim('Skill:')}     ${skillTitle}`)
        if (skillDescription) {
          console.log(`  ${chalk.dim('Description:')} ${skillDescription}`)
        }
      }

      console.log()
    })
}
