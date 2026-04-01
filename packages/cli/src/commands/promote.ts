import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectInstalledAgents } from '@agentver/agent-definitions'
import { executeInstall, type InstallRequest, planInstall } from '@agentver/installer'
import type {
  LocalSource,
  LockfileV2,
  ManifestV2,
  PackageSource,
  PlatformSource,
  PromoteResult,
  GitSource as SharedGitSource,
  UnknownSource,
} from '@agentver/shared'
import { parseSkillFrontmatter } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { readFilesFromDirectory } from '../git/fetcher.js'
import { createGitRepoCache, resolveLocalGitContext } from '../git/local-context.js'
import type { GitSource } from '../git/types.js'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { platformFetch } from '../registry/platform.js'
import { scanFiles } from '../security/index.js'
import { computeSha256FromFiles } from '../storage/integrity.js'
import { readManifest } from '../storage/manifest.js'
import { createPackageKey, resolvePackageQuery } from '../storage/package-identity.js'
import { updateManifestAndLockfile } from '../storage/pair.js'
import { extractError } from '../utils.js'

type PromoteTarget = 'platform' | 'git'

type PromoteOptions = {
  to: PromoteTarget
  org?: string
  yes?: boolean
  dryRun?: boolean
  json?: boolean
  global?: boolean
  canonicalise?: boolean
  all?: boolean
  skipAudit?: boolean
}

type PublishResponse = {
  version: string
  commitSha: string
}

type PromoteEntry = {
  packageKey: string
  displayName: string
  previousSource: PackageSource
  newSource: PackageSource
  dirty?: boolean
  canonicalised?: boolean
  /** Pre-computed integrity for the new source (avoids async in sync callback). */
  newIntegrity?: string
}

/**
 * Checks whether a source type is eligible for promotion.
 * Only local and unknown sources can be promoted.
 */
function isPromotable(source: PackageSource): source is LocalSource | UnknownSource {
  return source.type === 'local' || source.type === 'unknown'
}

/**
 * Resolves the filesystem path for a package from its source or manifest path.
 */
function resolvePackagePath(
  source: PackageSource,
  manifestPath: string | undefined
): string | null {
  if (manifestPath) {
    return manifestPath
  }

  if (source.type === 'local') {
    return source.path
  }

  if (source.type === 'unknown' && source.path) {
    return source.path
  }

  return null
}

/**
 * Promote a single package to a git source (metadata-only, no network calls).
 */
async function promoteToGit(
  packageKey: string,
  displayName: string,
  previousSource: PackageSource,
  packagePath: string,
  spinner: { text: string }
): Promise<PromoteEntry> {
  spinner.text = `Resolving git context for ${displayName}...`

  const gitCache = createGitRepoCache()
  const context = await resolveLocalGitContext(packagePath, gitCache)

  if (!context) {
    throw new Error(
      `"${displayName}" is not inside a git repository. ` +
        'Initialise a git repo or use --to platform instead.'
    )
  }

  if (!context.remoteUri) {
    throw new Error(
      `"${displayName}" is in a git repo but has no remote configured. ` +
        'Push to a remote first, then re-run promote.'
    )
  }

  const newSource: SharedGitSource = {
    type: 'git',
    uri: context.remoteUri,
    path: context.relativePath,
    ref: context.ref,
    commit: context.commit,
  }

  return {
    packageKey,
    displayName,
    previousSource,
    newSource,
    dirty: context.dirty,
  }
}

/**
 * Promote a single package to the platform.
 */
async function promoteToPlatform(
  packageKey: string,
  displayName: string,
  previousSource: PackageSource,
  packagePath: string,
  org: string,
  options: { skipAudit?: boolean; dryRun?: boolean },
  spinner: { text: string }
): Promise<PromoteEntry> {
  const skillMdPath = join(packagePath, 'SKILL.md')
  if (!existsSync(skillMdPath)) {
    throw new Error(
      `No SKILL.md found in ${packagePath}. Cannot promote to platform without a skill manifest.`
    )
  }

  const skillMdContent = readFileSync(skillMdPath, 'utf-8')

  let frontmatter: ReturnType<typeof parseSkillFrontmatter>['frontmatter']
  try {
    const parsed = parseSkillFrontmatter(skillMdContent)
    frontmatter = parsed.frontmatter
  } catch (error) {
    throw new Error(
      `Invalid SKILL.md frontmatter: ${error instanceof Error ? error.message : 'Ensure name, description, and version are set.'}`
    )
  }

  spinner.text = `Reading skill files for ${displayName}...`
  const localFiles = await readFilesFromDirectory(packagePath)

  if (localFiles.length === 0) {
    throw new Error(`No files found in ${packagePath}.`)
  }

  if (!options.skipAudit) {
    spinner.text = `Running security audit for ${displayName}...`

    const scanSource: GitSource = {
      host: 'local',
      owner: org,
      repo: displayName,
      path: '',
      ref: 'local',
    }

    const scanResult = await scanFiles(localFiles, scanSource, {
      skipAudit: false,
    })

    if (scanResult.verdict === 'BLOCK') {
      const findings = scanResult.findings
        .map((f) => `  ${f.file}:${String(f.line ?? '?')} — ${f.message}`)
        .join('\n')
      throw new Error(
        `Security audit failed for ${displayName}. Fix the issues before promoting:\n${findings}`
      )
    }
  }

  const filesToPublish = localFiles.map((f) => ({
    path: f.path,
    content: f.content,
  }))

  const newIntegrity = computeSha256FromFiles(filesToPublish)

  if (options.dryRun) {
    const newSource: PlatformSource = {
      type: 'platform',
      uri: `agentver://${org}`,
      path: `skills/${displayName}`,
      ref: 'main',
      commit: 'dry-run',
    }

    return {
      packageKey,
      displayName,
      previousSource,
      newSource,
      newIntegrity,
    }
  }

  spinner.text = `Publishing ${displayName} to @${org}...`

  const version = frontmatter.version ?? '0.1.0'

  const result = await platformFetch<PublishResponse>(`/skills/@${org}/${displayName}/publish`, {
    method: 'POST',
    body: {
      files: filesToPublish,
      version,
    },
  })

  const newSource: PlatformSource = {
    type: 'platform',
    uri: `agentver://${org}`,
    path: `skills/${displayName}`,
    ref: 'main',
    commit: result.commitSha,
  }

  return {
    packageKey,
    displayName,
    previousSource,
    newSource,
    newIntegrity,
  }
}

/**
 * Core promote logic for a single package.
 */
async function promoteSingle(
  packageKey: string,
  displayName: string,
  previousSource: PackageSource,
  manifestPath: string | undefined,
  target: PromoteTarget,
  options: PromoteOptions,
  spinner: { text: string }
): Promise<PromoteEntry> {
  const packagePath = resolvePackagePath(previousSource, manifestPath)
  if (!packagePath) {
    throw new Error(
      `Cannot determine filesystem path for "${displayName}". ` +
        'Ensure the package has a valid local or unknown source with a path.'
    )
  }

  switch (target) {
    case 'git':
      return promoteToGit(packageKey, displayName, previousSource, packagePath, spinner)

    case 'platform': {
      if (!options.org) {
        throw new Error(
          'The --org flag is required when promoting to the platform. ' +
            'Usage: agentver promote <name> --to platform --org <slug>'
        )
      }
      return promoteToPlatform(
        packageKey,
        displayName,
        previousSource,
        packagePath,
        options.org,
        { skipAudit: options.skipAudit, dryRun: options.dryRun },
        spinner
      )
    }
  }
}

/**
 * Move package files into canonical storage with symlinks.
 * Uses the installer's plan + execute pipeline to place files correctly.
 */
async function canonicalisePackage(
  entry: PromoteEntry,
  packagePath: string,
  projectRoot: string,
  agents: string[],
  spinner: { text: string },
  scope: 'project' | 'global'
): Promise<void> {
  spinner.text = `Canonicalising ${entry.displayName}...`

  const files = await readFilesFromDirectory(packagePath)
  if (files.length === 0) {
    throw new Error(`No files found in ${packagePath} to canonicalise.`)
  }

  const fileEntries = files.map((f) => ({ path: f.path, content: f.content }))
  const integrity = computeSha256FromFiles(fileEntries)
  const packageKey = createPackageKey(entry.displayName, entry.newSource)

  const request: InstallRequest = {
    packageKey,
    displayName: entry.displayName,
    packageType: 'SKILL',
    source: entry.newSource,
    files: fileEntries,
    integrity,
    target: {
      scope,
      projectRoot,
      agents,
    },
    policy: {
      conflictStrategy: 'force',
      preferredLinkMode: 'symlink',
      allowFallback: true,
      dryRun: false,
      persist: false,
      securityScanPolicy: 'skip',
    },
  }

  const plan = planInstall(request)
  const result = executeInstall(plan)

  if (!result.success) {
    throw new Error(result.error?.message ?? 'Failed to canonicalise package files.')
  }

  for (const backup of result.backups) {
    backup.cleanup()
  }

  entry.canonicalised = true
  entry.newIntegrity = integrity
}

/**
 * Apply a promote entry to the manifest and lockfile.
 * Moves the package from its old key to a new key derived from the new source.
 */
function applyPromoteEntry(
  currentManifest: ManifestV2,
  currentLockfile: LockfileV2,
  entry: PromoteEntry
): void {
  const manifestPkg = currentManifest.packages[entry.packageKey]
  const lockfilePkg = currentLockfile.packages[entry.packageKey]

  if (!manifestPkg) return

  const oldKey = entry.packageKey
  const newKey = createPackageKey(entry.displayName, entry.newSource)

  const updatedManifestPkg: (typeof currentManifest.packages)[string] = {
    ...manifestPkg,
    source: entry.newSource,
    modified: entry.dirty ?? false,
    name: entry.displayName,
  }

  if (entry.canonicalised) {
    delete (updatedManifestPkg as Record<string, unknown>).path
  }

  currentManifest.packages[newKey] = updatedManifestPkg
  if (newKey !== oldKey) {
    delete currentManifest.packages[oldKey]
  }

  if (lockfilePkg) {
    currentLockfile.packages[newKey] = {
      ...lockfilePkg,
      source: entry.newSource,
      integrity: entry.newIntegrity ?? lockfilePkg.integrity,
      name: entry.displayName,
    }
    if (newKey !== oldKey) {
      delete currentLockfile.packages[oldKey]
    }
  }
}

/**
 * Render a single promote result in text mode.
 */
function renderPromoteResult(entry: PromoteEntry, dryRun: boolean): void {
  const prefix = dryRun ? chalk.yellow('[dry-run] ') : ''
  const sourceLabel = entry.newSource.type === 'git' ? 'git' : 'platform'

  const uriDisplay =
    entry.newSource.type === 'git'
      ? entry.newSource.uri
      : entry.newSource.type === 'platform'
        ? entry.newSource.uri
        : 'unknown'

  process.stdout.write(
    `${prefix}${chalk.bold(`Promoting ${entry.displayName} to ${sourceLabel}...`)}\n`
  )
  process.stdout.write(
    `  Source: ${chalk.dim(entry.previousSource.type)} ${chalk.dim('\u2192')} ${chalk.cyan(sourceLabel)} ${chalk.dim(`(${uriDisplay})`)}\n`
  )

  if (entry.newSource.type === 'git' || entry.newSource.type === 'platform') {
    if (entry.newSource.path) {
      process.stdout.write(`  Path: ${chalk.dim(entry.newSource.path)}\n`)
    }
    const shortCommit = entry.newSource.commit.slice(0, 7)
    process.stdout.write(`  Ref: ${chalk.dim(`${entry.newSource.ref} @ ${shortCommit}`)}\n`)
  }

  if (entry.dirty) {
    process.stdout.write(
      `  ${chalk.yellow('\u26a0')} ${chalk.yellow('Working tree is dirty \u2014 remote may differ')}\n`
    )
  }

  if (entry.canonicalised) {
    process.stdout.write(
      `  ${chalk.dim('\u21b3')} Files canonicalised to .agents/skills/${entry.displayName}/\n`
    )
  }

  const verb = dryRun ? 'Would promote' : 'Promoted'
  process.stdout.write(
    `\n${chalk.green('\u2713')} ${verb} ${chalk.green(entry.displayName)} to ${sourceLabel} source\n`
  )
}

/**
 * Main promote handler.
 */
export async function promoteSkills(
  nameArg: string | undefined,
  options: PromoteOptions
): Promise<void> {
  const jsonMode = isJSONMode()
  const spinner = createSpinner('Preparing promotion...').start()
  const projectRoot = process.cwd()
  const scope = options.global ? 'global' : 'project'

  try {
    const manifest = readManifest(projectRoot, scope)

    // --all mode: promote all local/unknown packages
    if (options.all) {
      if (options.to !== 'git') {
        throw new Error(
          'The --all flag can only be used with --to git. ' +
            'Platform promotion requires per-package configuration.'
        )
      }

      spinner.text = 'Finding promotable packages...'

      const promotable = Object.entries(manifest.packages).filter(([, pkg]) =>
        isPromotable(pkg.source)
      )

      if (promotable.length === 0) {
        if (jsonMode) {
          outputSuccess({ promoted: [], message: 'No local or unknown packages found to promote.' })
          return
        }
        spinner.warn('No local or unknown packages found to promote.')
        return
      }

      const results: PromoteEntry[] = []
      const errors: Array<{ name: string; error: string }> = []

      for (const [key, pkg] of promotable) {
        const displayName = pkg.name ?? key
        try {
          const entry = await promoteSingle(
            key,
            displayName,
            pkg.source,
            pkg.path,
            'git',
            options,
            spinner
          )

          if (options.canonicalise && !options.dryRun) {
            const currentPath = resolvePackagePath(pkg.source, pkg.path)
            if (currentPath) {
              const agents =
                pkg.agents.length > 0
                  ? pkg.agents
                  : detectInstalledAgents(projectRoot).map((a) => a.id)
              await canonicalisePackage(entry, currentPath, projectRoot, agents, spinner, scope)
            }
          }

          results.push(entry)
        } catch (error) {
          errors.push({
            name: displayName,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (!options.dryRun && results.length > 0) {
        updateManifestAndLockfile(projectRoot, scope, (currentManifest, currentLockfile) => {
          for (const entry of results) {
            applyPromoteEntry(currentManifest, currentLockfile, entry)
          }
          return { manifest: currentManifest, lockfile: currentLockfile }
        })
      }

      if (jsonMode) {
        const promoteResults: PromoteResult[] = results.map((r) => ({
          type: 'PROMOTE_SUCCESS' as const,
          packageKey: r.packageKey,
          displayName: r.displayName,
          previousSource: r.previousSource,
          newSource: r.newSource,
          dirty: r.dirty,
          canonicalised: r.canonicalised,
        }))
        outputSuccess({ promoted: promoteResults, errors })
        return
      }

      spinner.stop()

      for (const entry of results) {
        renderPromoteResult(entry, options.dryRun ?? false)
        process.stdout.write('\n')
      }

      if (errors.length > 0) {
        process.stdout.write(chalk.bold('\nFailed:\n'))
        for (const err of errors) {
          process.stdout.write(
            `  ${chalk.red('\u2717')} ${chalk.red(err.name)}: ${chalk.dim(err.error)}\n`
          )
        }
      }

      const summary = `Promoted ${results.length}, failed ${errors.length} of ${promotable.length} packages.\n`
      process.stdout.write(chalk.dim(summary))
      return
    }

    // Single-package promotion
    if (!nameArg) {
      throw new Error(
        'Package name is required. Usage: agentver promote <name> --to <target>\n' +
          'Or use --all to promote all local packages.'
      )
    }

    const lookup = resolvePackageQuery(manifest.packages, nameArg)

    if (!lookup.ok) {
      if (lookup.reason === 'ambiguous') {
        throw new Error(
          `Ambiguous package name "${nameArg}". Matches: ${lookup.matches.join(', ')}`
        )
      }
      throw new Error(
        `Package "${nameArg}" not found in manifest. Run \`agentver adopt\` first to register local skills.`
      )
    }

    const { key: packageKey, displayName, pkg } = lookup

    if (!isPromotable(pkg.source)) {
      throw new Error(
        `Package "${displayName}" already has a ${pkg.source.type} source. ` +
          'Only local or unknown packages can be promoted.'
      )
    }

    const entry = await promoteSingle(
      packageKey,
      displayName,
      pkg.source,
      pkg.path,
      options.to,
      options,
      spinner
    )

    if (options.canonicalise && !options.dryRun) {
      const currentPath = resolvePackagePath(pkg.source, pkg.path)
      if (currentPath) {
        const agents =
          pkg.agents.length > 0 ? pkg.agents : detectInstalledAgents(projectRoot).map((a) => a.id)
        await canonicalisePackage(entry, currentPath, projectRoot, agents, spinner, scope)
      }
    }

    if (!options.dryRun) {
      updateManifestAndLockfile(projectRoot, scope, (currentManifest, currentLockfile) => {
        applyPromoteEntry(currentManifest, currentLockfile, entry)
        return { manifest: currentManifest, lockfile: currentLockfile }
      })
    }

    if (jsonMode) {
      const result: PromoteResult = {
        type: 'PROMOTE_SUCCESS',
        packageKey,
        displayName,
        previousSource: pkg.source,
        newSource: entry.newSource,
        dirty: entry.dirty,
        canonicalised: entry.canonicalised,
      }
      outputSuccess(result)
      return
    }

    spinner.stop()
    renderPromoteResult(entry, options.dryRun ?? false)
  } catch (error) {
    const { code, message } = extractError(error, 'PROMOTE_FAILED')

    if (jsonMode) {
      outputError(code, message)
      process.exit(1)
    }

    spinner.fail(`Failed to promote: ${message}`)
    process.exit(1)
  }
}

export function registerPromoteCommand(program: Command): void {
  program
    .command('promote [name]')
    .description('Promote a local or unknown skill to a remote source (git or platform)')
    .requiredOption('--to <target>', 'Promotion target: platform or git')
    .option('--org <slug>', 'Organisation slug (required for --to platform)')
    .option('--yes', 'Skip confirmation prompts')
    .option('--dry-run', 'Show what would happen without making changes')
    .option('--json', 'Output results as JSON')
    .option('--global', 'Operate on global scope')
    .option('--canonicalise', 'Move files to canonical storage and create symlinks')
    .option('--all', 'Promote all local packages')
    .option('--skip-audit', 'Skip security scan')
    .action(async (name: string | undefined, options: PromoteOptions) => {
      const validTargets: PromoteTarget[] = ['platform', 'git']
      if (!validTargets.includes(options.to)) {
        const msg = `Invalid promotion target "${options.to}". Must be one of: ${validTargets.join(', ')}`
        if (isJSONMode()) {
          outputError('VALIDATION_ERROR', msg)
          process.exit(1)
        }
        process.stderr.write(chalk.red(`${msg}\n`))
        process.exit(1)
      }

      await promoteSkills(name, options)
    })
}
