import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, normalize } from 'node:path'
import {
  type AgentId,
  getAgentPlacementPath,
  getCommandPlacementPath,
  getSkillPlacementPath,
} from '@agentver/agent-definitions'
import type { ManifestV2Package, UpdateResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import prompts from 'prompts'
import { readFilesFromDirectory } from '../git/fetcher.js'
import { fetchFiles, resolveRef } from '../git/index.js'
import type { GitSource as CliGitSource, ResolvedRef } from '../git/types.js'
import type { SpinnerLike } from '../output.js'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { type PlatformResolveResponse, platformFetch } from '../registry/platform.js'
import { getCanonicalSkillPath, resolveReadPath } from '../storage/canonical.js'
import { computeSha256FromFiles, deriveCommitFromIntegrity } from '../storage/integrity'
import { readLockfile } from '../storage/lockfile'
import { readManifest } from '../storage/manifest'
import { getPackageDisplayName, resolvePackageQuery } from '../storage/package-identity'
import { applyPatch, generatePatch, removePatch, savePatch } from '../storage/patches.js'
import { type BackupState, cleanupBackup, createBackup, restoreBackup } from '../utils/backup'
import { resolvePlacementPath, type Scope } from '../utils/paths'
import { extractError } from '../utils.js'
import { fetchWellKnownIndex, fetchWellKnownSkill } from '../wellknown/index.js'
import { installPackage } from './install'

type UpdateInfo = {
  key: string
  displayName: string
  currentCommit: string
  latestCommit: string
  ref: string
  sourceUri: string
  sourcePath: string
  installSource: string
  supportsPatch: boolean
  locallyModified: boolean
}

type UpdateAction = 'replace' | 'patch' | 'skip'

/**
 * Validate a path read from the manifest before passing it to installPackage.
 * Rejects relative paths and paths containing traversal segments to prevent
 * a corrupted manifest from writing outside the expected directory.
 */
function validateManifestPath(path: string | undefined): string | undefined {
  if (!path) return undefined
  if (path.includes('..')) return undefined
  const normalised = normalize(path)
  if (!isAbsolute(normalised)) return undefined
  return normalised
}

function parseUriToCliSource(
  uri: string,
  path: string,
  ref: string,
  commit?: string
): CliGitSource | null {
  const parts = uri.split('/')
  if (parts.length < 3) return null

  return {
    host: parts[0] as CliGitSource['host'],
    owner: parts[1]!,
    repo: parts[2]!,
    path,
    ref,
    commit,
  }
}

function buildInstallSource(uri: string, path: string, ref: string): string {
  return path ? `${uri}/${path}@${ref}` : `${uri}@${ref}`
}

async function resolveLatestGitCommit(source: ManifestV2Package['source']): Promise<string | null> {
  if (source.type !== 'git') return null
  const cliSource = parseUriToCliSource(source.uri, source.path, source.ref)
  if (!cliSource) return null
  const resolved = await resolveRef(cliSource)
  return resolved.commitSha
}

async function resolveLatestPlatformCommit(
  source: ManifestV2Package['source']
): Promise<string | null> {
  if (source.type !== 'platform') return null

  const org = source.uri.slice('agentver://'.length).trim()
  if (!org) return null

  const resolveName = source.path ? `${org}/${source.path}` : org
  const resolved = await platformFetch<PlatformResolveResponse>(
    `/resolve?name=${encodeURIComponent(resolveName)}`
  )

  if (resolved.source === 'platform') {
    if (!resolved.files || resolved.files.length === 0) return null
    const integrity = computeSha256FromFiles(
      resolved.files.map((file) => ({ path: file.path, content: file.content }))
    )
    return deriveCommitFromIntegrity(integrity)
  }

  const cliSource = parseUriToCliSource(
    resolved.gitUri,
    resolved.gitPath ?? source.path,
    resolved.gitRef ?? source.ref
  )
  if (!cliSource) return null

  const gitResolved = await resolveRef(cliSource)
  return gitResolved.commitSha
}

async function resolveLatestWellKnownCommit(
  source: ManifestV2Package['source']
): Promise<string | null> {
  if (source.type !== 'well-known') return null

  const index = await fetchWellKnownIndex(source.baseUrl)
  const entry = index.skills.find((skill) => skill.name === source.skillName)
  if (!entry) return null

  const fetchResult = await fetchWellKnownSkill(source.baseUrl, entry)
  const integrity = computeSha256FromFiles(
    fetchResult.files.map((file) => ({ path: file.path, content: file.content }))
  )
  return deriveCommitFromIntegrity(integrity)
}

async function checkLocalModifications(
  projectRoot: string,
  packageKey: string,
  displayName: string,
  agents: string[],
  scope: Scope = 'project',
  packageType?: string,
  entryFile?: string
): Promise<boolean> {
  const lockfile = readLockfile(projectRoot, scope)
  const lockEntry = lockfile.packages[packageKey]
  if (!lockEntry) return false

  const shortName = displayName.split('/').pop()!

  if (packageType === 'AGENT' || packageType === 'COMMAND') {
    const getPlacementPath =
      packageType === 'AGENT' ? getAgentPlacementPath : getCommandPlacementPath
    const fileName = entryFile ?? `${shortName}.md`
    for (const agentId of agents) {
      const placementPath = getPlacementPath(agentId as AgentId, fileName, scope)
      if (!placementPath) continue
      const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
      if (!fullPath) continue
      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath, 'utf-8')
          const localIntegrity = computeSha256FromFiles([{ path: fileName, content }])
          if (localIntegrity !== lockEntry.integrity) return true
        } catch {
          // Read error for this placement — continue checking others
        }
      }
    }
    return false
  }

  const readPath = resolveReadPath(projectRoot, shortName, agents, scope)
  if (readPath) {
    try {
      const localFiles = await readFilesFromDirectory(readPath)
      if (localFiles.length === 0) return false

      const localIntegrity = computeSha256FromFiles(
        localFiles.map((f) => ({ path: f.path, content: f.content }))
      )

      return localIntegrity !== lockEntry.integrity
    } catch {
      return false
    }
  }

  return false
}

async function promptUpdateAction(packageName: string): Promise<UpdateAction> {
  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: `"${packageName}" has local modifications. What would you like to do?`,
    choices: [
      { title: 'Replace — discard local changes, apply upstream', value: 'replace' },
      { title: 'Patch — save local changes, apply upstream, reapply patch', value: 'patch' },
      { title: 'Skip — skip this package', value: 'skip' },
    ],
    initial: 1,
  })

  return (action as UpdateAction) ?? 'skip'
}

async function handlePatchUpdate(
  update: UpdateInfo,
  projectRoot: string,
  agents: string[],
  spinner: SpinnerLike,
  scope: Scope = 'project',
  installedPath?: string,
  packageType?: string,
  entryFile?: string
): Promise<{ commitSha: string } | null> {
  const lockfile = readLockfile(projectRoot, scope)
  const lockEntry = lockfile.packages[update.key]
  if (!lockEntry) return null

  const shortName = update.displayName.split('/').pop()!

  spinner.text = `Fetching original files for ${update.displayName} at locked commit...`

  const lockedSource = parseUriToCliSource(
    update.sourceUri,
    update.sourcePath,
    update.ref,
    update.currentCommit
  )
  if (!lockedSource) return null

  const lockedResolved: ResolvedRef = {
    source: lockedSource,
    commitSha: update.currentCommit,
  }

  let baseFiles: Array<{ path: string; content: string }>
  try {
    const fetchResult = await fetchFiles(lockedResolved, {
      expectedIntegrity: lockEntry.integrity,
    })
    baseFiles = fetchResult.files.map((f) => ({ path: f.path, content: f.content }))
  } catch (error) {
    spinner.warn(
      `Could not fetch original files for ${update.displayName}: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }

  const localFileArrays: Array<{ path: string; content: string }> = []
  let patchTargetPath: string | null = null
  if (packageType === 'AGENT' || packageType === 'COMMAND') {
    const getPlacement = packageType === 'AGENT' ? getAgentPlacementPath : getCommandPlacementPath
    const fileName = entryFile ?? `${shortName}.md`
    for (const agentId of agents) {
      const placement = getPlacement(agentId as AgentId, fileName, scope)
      if (!placement) continue
      const fullPath = resolvePlacementPath(placement, projectRoot, scope)
      if (!fullPath) continue
      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath, 'utf-8')
          localFileArrays.push({ path: fileName, content })
          patchTargetPath ??= fullPath
        } catch {
          // Best-effort read
        }
      }
    }
  } else {
    const readPath = resolveReadPath(projectRoot, shortName, agents, scope)
    if (readPath) {
      patchTargetPath = readPath
      try {
        const files = await readFilesFromDirectory(readPath)
        localFileArrays.push(...files.map((f) => ({ path: f.path, content: f.content })))
      } catch {
        // Best-effort read
      }
    }
  }

  spinner.text = `Generating patch for ${update.displayName}...`

  const patchContent = generatePatch(baseFiles, localFileArrays, update.displayName)

  if (!patchContent || patchContent.trim() === '') {
    spinner.info(
      `No meaningful differences found for ${update.displayName}, proceeding with standard update.`
    )
    return null
  }

  const patchPath = savePatch(projectRoot, update.displayName, patchContent)
  spinner.text = `Patch saved to ${patchPath}`

  spinner.text = `Applying upstream update for ${update.displayName}...`

  const sourceUrl = update.sourcePath
    ? `${update.sourceUri}/${update.sourcePath}@${update.ref}`
    : `${update.sourceUri}@${update.ref}`

  const patchTypeOption =
    packageType === 'AGENT' || packageType === 'COMMAND'
      ? { type: packageType.toLowerCase() as 'agent' | 'command' }
      : {}

  const result = await installPackage(sourceUrl, {
    ...(agents.length > 0 ? { agent: agents } : {}),
    ...(scope === 'global' ? { global: true } : {}),
    ...(installedPath ? { path: installedPath } : {}),
    ...patchTypeOption,
  })

  spinner.text = `Reapplying local patch for ${update.displayName}...`

  try {
    const patchPathTarget =
      patchTargetPath ??
      resolveReadPath(
        projectRoot,
        shortName,
        agents,
        scope,
        packageType === 'AGENT' ? 'agents' : packageType === 'COMMAND' ? 'commands' : 'skills'
      ) ??
      (packageType === 'AGENT' || packageType === 'COMMAND'
        ? null
        : getCanonicalSkillPath(projectRoot, shortName, scope))

    if (!patchPathTarget) {
      throw new Error('Could not determine the installed path to reapply the patch')
    }

    const applyResult = applyPatch(patchPathTarget, patchContent)

    if (applyResult.applied) {
      removePatch(projectRoot, update.displayName)
      spinner.succeed(
        `${chalk.green(update.displayName)}: updated and local patch reapplied successfully`
      )
    } else {
      spinner.warn(
        `${chalk.yellow(update.displayName)}: updated but patch had conflicts in: ${applyResult.conflicts.join(', ')}`
      )
      console.log(chalk.dim(`  Patch saved at: ${patchPath}`))
      console.log(chalk.dim('  Review the patch file and apply remaining changes manually.'))
    }
  } catch (error) {
    spinner.warn(
      `${chalk.yellow(update.displayName)}: updated but could not reapply patch: ${error instanceof Error ? error.message : String(error)}`
    )
    console.log(chalk.dim(`  Patch saved at: ${patchPath}`))
    console.log(chalk.dim('  Review the patch file and apply remaining changes manually.'))
  }

  return { commitSha: result.commitSha }
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update [name]')
    .description('Update installed skills to their latest upstream version')
    .option('--dry-run', 'Show what would be updated without making changes')
    .option('-y, --yes', 'Accept update prompts non-interactively')
    .option('--global', 'Update skills installed at user level (~/.agents/skills/)')
    .action(
      async (
        name: string | undefined,
        options: { dryRun?: boolean; global?: boolean; yes?: boolean }
      ) => {
        const jsonMode = isJSONMode()
        const projectRoot = process.cwd()
        const scope = options.global ? 'global' : 'project'
        const manifest = readManifest(projectRoot, scope)
        const selectedPackage = name ? resolvePackageQuery(manifest.packages, name) : null
        const packages =
          selectedPackage?.ok === true
            ? { [selectedPackage.key]: selectedPackage.pkg }
            : name
              ? {}
              : manifest.packages

        const packageKeys = Object.keys(packages).filter((key) => packages[key])

        if (packageKeys.length === 0) {
          if (jsonMode) {
            outputSuccess<UpdateResult>({ updated: [], skipped: [] })
            return
          }
          console.log(
            chalk.dim(name ? `Package "${name}" is not installed.` : 'No packages installed.')
          )
          return
        }

        const pinnedNames: string[] = []
        const unsupportedNames: string[] = []
        const updatable = packageKeys.filter((key) => {
          const pkg = packages[key]
          if (!pkg) return false
          if (pkg.pinned === true) {
            pinnedNames.push(key)
            return false
          }
          if (pkg.source.type === 'git' || pkg.source.type === 'platform') {
            return true
          }
          if (pkg.source.type === 'well-known') {
            return true
          }
          unsupportedNames.push(key)
          return false
        })

        if (pinnedNames.length > 0 && !jsonMode) {
          for (const pinnedName of pinnedNames) {
            console.log(
              chalk.dim(
                `Skipping ${getPackageDisplayName(pinnedName, packages[pinnedName]!)} (pinned)`
              )
            )
          }
        }

        if (updatable.length === 0) {
          if (jsonMode) {
            outputSuccess<UpdateResult>({
              updated: [],
              skipped: [
                ...pinnedNames.map((n) => ({
                  name: getPackageDisplayName(n, packages[n]!),
                  reason: 'pinned',
                })),
                ...unsupportedNames.map((n) => ({
                  name: getPackageDisplayName(n, packages[n]!),
                  reason: 'No known update source',
                })),
              ],
            })
            return
          }
          if (pinnedNames.length === 0) {
            console.log(chalk.dim('No packages with known update sources.'))
          }
          return
        }

        const spinner = createSpinner('Checking for upstream changes...').start()

        try {
          const updates: UpdateInfo[] = []
          const resolutionSkips: UpdateResult['skipped'] = []
          const lockfile = readLockfile(projectRoot, scope)

          for (const packageKey of updatable) {
            const pkg = packages[packageKey]!
            const displayName = getPackageDisplayName(packageKey, pkg)
            try {
              if (pkg.source.type === 'git' || pkg.source.type === 'platform') {
                const installSource = buildInstallSource(
                  pkg.source.uri,
                  pkg.source.path,
                  pkg.source.ref
                )
                const supportsPatch = pkg.source.type === 'git'
                const latestCommit =
                  pkg.source.type === 'platform'
                    ? await resolveLatestPlatformCommit(pkg.source)
                    : await resolveLatestGitCommit(pkg.source)

                if (!latestCommit) {
                  resolutionSkips.push({
                    name: displayName,
                    reason: 'Could not resolve upstream source',
                  })
                  if (!jsonMode) {
                    spinner.warn(`Could not check upstream for ${displayName}`)
                  }
                  continue
                }

                if (latestCommit !== pkg.source.commit) {
                  const locallyModified = supportsPatch
                    ? await checkLocalModifications(
                        projectRoot,
                        packageKey,
                        displayName,
                        pkg.agents,
                        scope,
                        pkg.packageType,
                        pkg.entryFile
                      )
                    : false

                  updates.push({
                    key: packageKey,
                    displayName,
                    currentCommit: pkg.source.commit,
                    latestCommit,
                    ref: pkg.source.ref,
                    sourceUri: pkg.source.uri,
                    sourcePath: pkg.source.path,
                    installSource,
                    supportsPatch,
                    locallyModified,
                  })
                }
                continue
              }

              if (pkg.source.type === 'well-known') {
                const wellKnownSource = pkg.source
                const lockEntry = lockfile.packages[packageKey]
                if (!lockEntry?.integrity) {
                  resolutionSkips.push({ name: displayName, reason: 'No lockfile integrity found' })
                  if (!jsonMode) {
                    spinner.warn(`Could not check upstream for ${displayName}`)
                  }
                  continue
                }

                const latestCommit = await resolveLatestWellKnownCommit(wellKnownSource)
                if (!latestCommit) {
                  resolutionSkips.push({
                    name: displayName,
                    reason: 'Could not resolve well-known source',
                  })
                  if (!jsonMode) {
                    spinner.warn(`Could not check upstream for ${displayName}`)
                  }
                  continue
                }

                const currentCommit = deriveCommitFromIntegrity(lockEntry.integrity)
                if (latestCommit !== currentCommit) {
                  updates.push({
                    key: packageKey,
                    displayName,
                    currentCommit,
                    latestCommit,
                    ref: 'well-known',
                    sourceUri: wellKnownSource.baseUrl,
                    sourcePath: wellKnownSource.skillName,
                    installSource: `${wellKnownSource.baseUrl}/${wellKnownSource.skillName}`,
                    supportsPatch: false,
                    locallyModified: false,
                  })
                }
                continue
              }

              resolutionSkips.push({ name: displayName, reason: 'No known update source' })
            } catch {
              resolutionSkips.push({
                name: displayName,
                reason: 'Could not resolve upstream source',
              })
              spinner.warn(`Could not check upstream for ${displayName}`)
            }
          }

          spinner.stop()

          if (updates.length === 0) {
            if (jsonMode) {
              outputSuccess<UpdateResult>({
                updated: [],
                skipped: [
                  ...pinnedNames.map((n) => ({
                    name: getPackageDisplayName(n, packages[n]!),
                    reason: 'pinned',
                  })),
                  ...unsupportedNames.map((n) => ({
                    name: getPackageDisplayName(n, packages[n]!),
                    reason: 'No known update source',
                  })),
                  ...resolutionSkips,
                ],
              })
              return
            }
            console.log(chalk.green('All packages are up to date.'))
            return
          }

          if (!jsonMode) {
            console.log(chalk.bold(`\nUpstream changes available (${updates.length}):\n`))

            for (const update of updates) {
              const modifiedIndicator = update.locallyModified
                ? ` ${chalk.yellow('\u26a0 locally modified')}`
                : ''
              console.log(
                `  ${chalk.green(update.displayName)}: ${chalk.dim(update.currentCommit.slice(0, 7))} \u2192 ${chalk.cyan(update.latestCommit.slice(0, 7))} ${chalk.dim(`(${update.ref})`)}${modifiedIndicator}`
              )
            }

            console.log()
          }

          if (options.dryRun) {
            if (jsonMode) {
              outputSuccess<UpdateResult>({
                updated: [],
                skipped: [
                  ...pinnedNames.map((n) => ({
                    name: getPackageDisplayName(n, packages[n]!),
                    reason: 'pinned',
                  })),
                  ...unsupportedNames.map((n) => ({
                    name: getPackageDisplayName(n, packages[n]!),
                    reason: 'No known update source',
                  })),
                  ...resolutionSkips,
                  ...updates.map((u) => ({ name: u.displayName, reason: 'dry-run' })),
                ],
              })
              return
            }
            console.log(`${chalk.yellow('[dry-run]')} No changes made.`)
            return
          }

          if (!jsonMode && !options.yes) {
            const { confirmed } = await prompts({
              type: 'confirm',
              name: 'confirmed',
              message: `Update ${updates.length} package(s)?`,
              initial: true,
            })

            if (!confirmed) {
              console.log(chalk.dim('Update cancelled.'))
              return
            }
          }

          const jsonUpdated: UpdateResult['updated'] = []
          const jsonSkipped: UpdateResult['skipped'] = []
          const results: Array<{ name: string; from: string; to: string; patched?: boolean }> = []
          const failures: Array<{ name: string; error: string }> = []
          const skipped: string[] = []

          for (const update of updates) {
            const installedPkg = manifest.packages[update.key]
            const agents = installedPkg?.agents ?? []
            const installedPath = validateManifestPath(installedPkg?.path)

            if (update.locallyModified) {
              let action: UpdateAction

              if (jsonMode || options.yes) {
                action = 'replace'
              } else {
                action = await promptUpdateAction(update.displayName)
              }

              if (action === 'skip') {
                skipped.push(update.displayName)
                jsonSkipped.push({
                  name: update.displayName,
                  reason: 'User skipped (locally modified)',
                })
                continue
              }

              if (action === 'patch' && update.supportsPatch) {
                const updateSpinner = createSpinner(
                  `Processing patch update for ${update.displayName}...`
                ).start()

                try {
                  const patchResult = await handlePatchUpdate(
                    update,
                    projectRoot,
                    agents,
                    updateSpinner,
                    scope,
                    installedPath,
                    installedPkg?.packageType,
                    installedPkg?.entryFile
                  )

                  if (patchResult) {
                    results.push({
                      name: update.displayName,
                      from: update.currentCommit.slice(0, 7),
                      to: patchResult.commitSha.slice(0, 7),
                      patched: true,
                    })
                    jsonUpdated.push({
                      name: update.displayName,
                      fromRef: update.currentCommit.slice(0, 7),
                      toRef: patchResult.commitSha.slice(0, 7),
                      strategy: 'patch',
                    })
                    continue
                  }
                } catch (error) {
                  updateSpinner.fail(
                    `Patch update failed for ${update.displayName}: ${error instanceof Error ? error.message : String(error)}`
                  )
                  failures.push({
                    name: update.displayName,
                    error: error instanceof Error ? error.message : String(error),
                  })
                  jsonSkipped.push({
                    name: update.displayName,
                    reason: `Patch failed: ${error instanceof Error ? error.message : String(error)}`,
                  })
                  continue
                }
              }
            }

            const shortName = update.displayName.split('/').pop()!
            const pkgType = installedPkg?.packageType
            const isSingleFileUpdate = pkgType === 'AGENT' || pkgType === 'COMMAND'

            let backupDir: string | null = null
            if (isSingleFileUpdate) {
              // Single-file packages: back up the parent directory containing the placed file
              const getPlacement =
                pkgType === 'AGENT' ? getAgentPlacementPath : getCommandPlacementPath
              const entryFileName = installedPkg?.entryFile ?? `${shortName}.md`
              const backupRoots = agents
                .map((agentId) => {
                  const placement = getPlacement(agentId as AgentId, entryFileName, scope)
                  const resolvedPlacement = placement
                    ? resolvePlacementPath(placement, projectRoot, scope)
                    : null
                  return resolvedPlacement ? dirname(resolvedPlacement) : null
                })
                .filter((path): path is string => Boolean(path))

              backupDir = backupRoots.length > 0 ? backupRoots.join('\0') : null
            } else {
              const placementPath = agents[0]
                ? getSkillPlacementPath(agents[0] as AgentId, shortName, scope)
                : null
              const fallbackDir = placementPath
                ? resolvePlacementPath(placementPath, projectRoot, scope)
                : null
              backupDir = resolveReadPath(projectRoot, shortName, agents, scope) ?? fallbackDir
            }

            let backup: BackupState | null = null

            try {
              backup = createBackup(
                update.displayName,
                projectRoot,
                backupDir?.includes('\0') ? backupDir.split('\0') : backupDir,
                scope
              )

              const typeOption = isSingleFileUpdate
                ? { type: pkgType.toLowerCase() as 'agent' | 'command' }
                : {}

              const result = await installPackage(update.installSource, {
                ...(agents.length > 0 ? { agent: agents } : {}),
                ...(scope === 'global' ? { global: true } : {}),
                ...(installedPath ? { path: installedPath } : {}),
                ...typeOption,
              })

              cleanupBackup(backup)

              results.push({
                name: update.displayName,
                from: update.currentCommit.slice(0, 7),
                to: result.commitSha.slice(0, 7),
              })
              jsonUpdated.push({
                name: update.displayName,
                fromRef: update.currentCommit.slice(0, 7),
                toRef: result.commitSha.slice(0, 7),
                strategy: 'replace',
              })
            } catch (error) {
              if (backup) {
                try {
                  restoreBackup(backup)
                  cleanupBackup(backup)
                } catch {
                  // Best-effort restore
                }
              }

              failures.push({
                name: update.displayName,
                error: error instanceof Error ? error.message : String(error),
              })
              jsonSkipped.push({
                name: update.displayName,
                reason: `Failed: ${error instanceof Error ? error.message : String(error)}`,
              })
            }
          }

          if (jsonMode) {
            outputSuccess<UpdateResult>({
              updated: jsonUpdated,
              skipped: [
                ...pinnedNames.map((n) => ({
                  name: getPackageDisplayName(n, packages[n]!),
                  reason: 'pinned',
                })),
                ...unsupportedNames.map((n) => ({
                  name: getPackageDisplayName(n, packages[n]!),
                  reason: 'No known update source',
                })),
                ...resolutionSkips,
                ...jsonSkipped,
              ],
            })
            return
          }

          console.log(chalk.bold('\nUpdate summary:\n'))

          for (const result of results) {
            const patchNote = result.patched ? chalk.dim(' (patch reapplied)') : ''
            console.log(
              `  ${chalk.green('\u2713')} ${result.name}: ${chalk.dim(result.from)} \u2192 ${chalk.cyan(result.to)}${patchNote}`
            )
          }

          for (const skippedName of skipped) {
            console.log(`  ${chalk.dim('\u2013')} ${skippedName}: ${chalk.dim('skipped')}`)
          }

          for (const failure of failures) {
            console.log(`  ${chalk.red('\u2717')} ${failure.name}: ${failure.error}`)
          }

          if (failures.length > 0) {
            console.log(chalk.dim('\nFailed packages were rolled back to their previous versions.'))
          }

          console.log()
        } catch (error) {
          const { code, message } = extractError(error, 'UPDATE_FAILED')
          if (jsonMode) {
            outputError(code, message)
            process.exit(1)
          }
          spinner.fail(`Update check failed: ${message}`)
          process.exit(1)
        }
      }
    )
}
