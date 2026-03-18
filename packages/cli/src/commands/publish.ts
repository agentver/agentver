import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import ora from 'ora'
import { readFilesFromDirectory } from '../git/fetcher.js'
import type { GitSource } from '../git/types.js'
import { platformFetch } from '../registry/platform.js'
import { scanFiles } from '../security/index.js'

type PublishOptions = {
  version?: string
  public?: boolean
  dryRun?: boolean
  skipAudit?: boolean
  json?: boolean
}

type PublishResponse = {
  version: string
  commitSha: string
}

type SkillFrontmatter = {
  name: string
  description: string
  version: string
}

const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[\w.]+)?$/

/**
 * Parse YAML-like frontmatter from a SKILL.md file.
 * Intentionally simple — handles the common key: value format.
 */
function parseFrontmatter(content: string): SkillFrontmatter | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch?.[1]) return null

  const lines = fmMatch[1].split('\n')
  const data: Record<string, string> = {}

  for (const line of lines) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (key && value) {
      data[key] = value
    }
  }

  if (!data.name || !data.description || !data.version) {
    return null
  }

  return {
    name: data.name,
    description: data.description,
    version: data.version,
  }
}

/**
 * Detect the org/namespace from the skill directory context.
 * Uses the directory structure or manifest to determine the namespace.
 */
function detectNamespace(skillDir: string): { org: string; name: string } | null {
  const skillMdPath = join(skillDir, 'SKILL.md')
  if (!existsSync(skillMdPath)) return null

  const content = readFileSync(skillMdPath, 'utf-8')
  const fm = parseFrontmatter(content)
  if (!fm) return null

  // Try to extract org from directory structure (e.g. .agentver/skills/org/name)
  const parts = skillDir.split('/')
  const skillsIdx = parts.lastIndexOf('skills')
  if (skillsIdx >= 0 && parts.length > skillsIdx + 2) {
    return { org: parts[skillsIdx + 1]!, name: fm.name }
  }

  // Fall back to using the parent directory as org
  const parentDir = basename(resolve(skillDir, '..'))
  return { org: parentDir, name: fm.name }
}

export function registerPublishCommand(program: Command): void {
  program
    .command('publish [path]')
    .description('Publish a skill to the registry')
    .option('--version <semver>', 'Version to publish (uses frontmatter version if omitted)')
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

      const spinner = ora('Reading skill metadata...').start()

      try {
        // Parse frontmatter
        const skillMdContent = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')
        const frontmatter = parseFrontmatter(skillMdContent)

        if (!frontmatter) {
          spinner.fail(
            'Invalid SKILL.md frontmatter. Ensure name, description, and version are set.'
          )
          process.exit(1)
        }

        const version = options.version ?? frontmatter.version
        if (!SEMVER_REGEX.test(version)) {
          spinner.fail(`Invalid version "${version}". Must be valid semver (e.g. 1.0.0).`)
          process.exit(1)
        }

        const namespace = detectNamespace(skillDir)
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
            console.log(
              JSON.stringify(
                {
                  dryRun: true,
                  skill: `@${namespace.org}/${namespace.name}`,
                  version,
                  files: filesToPublish.map((f) => f.path),
                  frontmatter,
                },
                null,
                2
              )
            )
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

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                skill: `@${namespace.org}/${namespace.name}`,
                version: result.version,
                commitSha: result.commitSha,
              },
              null,
              2
            )
          )
        } else {
          spinner.succeed(
            `Published ${chalk.green(frontmatter.name)}@${chalk.cyan(result.version)} ${chalk.dim(`(${result.commitSha.slice(0, 7)})`)}`
          )
        }
      } catch (error) {
        spinner.fail(`Failed to publish: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
    })
}
