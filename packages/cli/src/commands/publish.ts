import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { type AgentverSkill, parseSkillFrontmatter } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { readFilesFromDirectory } from '../git/fetcher.js'
import type { GitSource } from '../git/types.js'
import { createSpinner, outputSuccess } from '../output.js'
import { platformFetch } from '../registry/platform.js'
import { scanFiles } from '../security/index.js'
import { computeSha256FromFiles } from '../storage/integrity.js'
import { updateManifestAndLockfile } from '../storage/pair.js'
import { extractError, SEMVER_REGEX } from '../utils.js'
import { resolveNamespace } from './skill-context.js'

type PublishOptions = {
  version?: string
  org?: string
  public?: boolean
  dryRun?: boolean
  skipAudit?: boolean
  json?: boolean
}

type PublishResponse = {
  version: string
  commitSha: string
}

export function registerPublishCommand(program: Command): void {
  program
    .command('publish [path]')
    .description('Publish a skill to the registry')
    .option('--version <semver>', 'Version to publish (uses frontmatter version if omitted)')
    .option('--org <org>', 'Organisation slug for unmanaged or adopted skills')
    .option('--public', 'Set package visibility to public')
    .option('--dry-run', 'Validate without publishing')
    .option('--skip-audit', 'Skip security scan')
    .option('--json', 'Output as JSON')
    .action(async (pathArg: string | undefined, options: PublishOptions) => {
      const skillDir = pathArg ? resolve(process.cwd(), pathArg) : process.cwd()

      if (!existsSync(join(skillDir, 'SKILL.md'))) {
        process.stderr.write(
          chalk.red(`No SKILL.md found in ${skillDir}. Cannot publish without a skill manifest.\n`)
        )
        process.exit(1)
      }

      const spinner = createSpinner('Reading skill metadata...').start()

      try {
        // Parse frontmatter using shared validator
        const skillMdContent = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')

        let frontmatter: AgentverSkill
        try {
          const parsed = parseSkillFrontmatter(skillMdContent)
          frontmatter = parsed.frontmatter
        } catch (error) {
          spinner.fail(
            `Invalid SKILL.md frontmatter: ${error instanceof Error ? error.message : 'Ensure name, description, and version are set.'}`
          )
          process.exit(1)
        }

        const version = options.version ?? frontmatter.version
        if (!version || !SEMVER_REGEX.test(version)) {
          spinner.fail(
            `Invalid version "${version ?? '(none)'}". Must be valid semver (e.g. 1.0.0).`
          )
          process.exit(1)
        }

        const namespace =
          resolveNamespace({
            projectRoot: process.cwd(),
            skillDir,
            skillName: frontmatter.name,
            org: options.org,
          }) ??
          (options.org
            ? null
            : {
                org: basename(resolve(skillDir, '..')),
                name: frontmatter.name,
              })
        if (!namespace) {
          spinner.fail(
            'Could not determine skill namespace. Check SKILL.md and directory structure.'
          )
          process.exit(1)
        }

        // Read all files
        spinner.text = 'Reading skill files...'
        const localFiles = await readFilesFromDirectory(skillDir)

        if (localFiles.length === 0) {
          spinner.fail('No files found in skill directory.')
          process.exit(1)
        }

        // Security audit
        if (!options.skipAudit) {
          spinner.text = 'Running security audit...'

          // Create a minimal GitSource for the scanner
          const scanSource: GitSource = {
            host: 'local',
            owner: namespace.org,
            repo: namespace.name,
            path: '',
            ref: 'local',
          }

          const scanResult = await scanFiles(localFiles, scanSource, {
            skipAudit: false,
          })

          if (scanResult.verdict === 'BLOCK') {
            spinner.fail('Security audit failed. Fix the issues before publishing.')
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

        const filesToPublish = localFiles.map((f) => ({
          path: f.path,
          content: f.content,
        }))

        if (options.dryRun) {
          spinner.stop()

          if (options.json) {
            outputSuccess({
              dryRun: true,
              skill: `@${namespace.org}/${namespace.name}`,
              version,
              files: filesToPublish.map((f) => f.path),
              frontmatter,
            })
          } else {
            process.stdout.write(
              chalk.yellow('[dry-run]') +
                ` Would publish ${chalk.green(frontmatter.name)}@${chalk.cyan(version)}\n`
            )
            process.stdout.write(chalk.dim(`  Namespace: @${namespace.org}/${namespace.name}\n`))
            process.stdout.write(
              chalk.dim(
                `  Files (${filesToPublish.length}): ${filesToPublish.map((f) => f.path).join(', ')}\n`
              )
            )
          }
          return
        }

        spinner.text = `Publishing ${frontmatter.name}@${version}...`

        const result = await platformFetch<PublishResponse>(
          `/skills/@${namespace.org}/${namespace.name}/publish`,
          {
            method: 'POST',
            body: {
              files: filesToPublish,
              version,
              ...(options.public ? { visibility: 'PUBLIC' as const } : {}),
            },
          }
        )

        const projectRoot = process.cwd()
        const integrity = computeSha256FromFiles(
          filesToPublish.map((file) => ({
            path: file.path,
            content: file.content,
          }))
        )

        updateManifestAndLockfile(projectRoot, 'project', (manifest, lockfile) => {
          const manifestEntry = manifest.packages[frontmatter.name]
          const lockEntry = lockfile.packages[frontmatter.name]
          const sourcePath =
            manifestEntry?.source.type === 'git' &&
            manifestEntry.source.uri.startsWith('agentver://')
              ? manifestEntry.source.path
              : ''

          if (manifestEntry?.source.type === 'git') {
            manifestEntry.source = {
              type: 'git',
              uri: `agentver://${namespace.org}`,
              path: sourcePath,
              ref: 'main',
              commit: result.commitSha,
            }
            manifestEntry.modified = false
          }

          if (lockEntry?.source.type === 'git') {
            lockEntry.source = {
              type: 'git',
              uri: `agentver://${namespace.org}`,
              path: sourcePath,
              ref: 'main',
              commit: result.commitSha,
            }
            lockEntry.integrity = integrity
          }

          return { manifest, lockfile }
        })

        if (options.json) {
          outputSuccess({
            skill: `@${namespace.org}/${namespace.name}`,
            version: result.version,
            commitSha: result.commitSha,
          })
        } else {
          spinner.succeed(
            `Published ${chalk.green(frontmatter.name)}@${chalk.cyan(result.version)} ${chalk.dim(`(${result.commitSha.slice(0, 7)})`)}`
          )
        }
      } catch (error) {
        const { message } = extractError(error, 'PUBLISH_FAILED')
        spinner.fail(`Failed to publish: ${message}`)
        process.exit(1)
      }
    })
}
