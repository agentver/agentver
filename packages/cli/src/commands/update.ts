import { existsSync, readFileSync } from 'node:fs'
import {
  type AgentId,
  getAgentPlacementPath,
  getCommandPlacementPath,
  getSkillPlacementPath,
} from '@agentver/agent-definitions'
import type { UpdateResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import prompts from 'prompts'
import { readFilesFromDirectory } from '../git/fetcher.js'
import { fetchFiles, resolveRef } from '../git/index.js'
import type { GitSource as CliGitSource, ResolvedRef } from '../git/types.js'
import type { SpinnerLike } from '../output.js'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { getCanonicalSkillPath, resolveReadPath } from '../storage/canonical.js'
import { computeSha256FromFiles } from '../storage/integrity'
import { readLockfile } from '../storage/lockfile'
import { readManifest } from '../storage/manifest'
import { applyPatch, generatePatch, removePatch, savePatch } from '../storage/patches.js'
import { type BackupState, cleanupBackup, createBackup, restoreBackup } from '../utils/backup'
import { resolvePlacementPath, type Scope } from '../utils/paths'
import { extractError } from '../utils.js'
import { installPackage } from './install'

type UpdateInfo = {
  name: string
  currentCommit: string
  latestCommit: string
  ref: string
  sourceUri: string
  sourcePath: string
  locallyModified: boolean
}

type UpdateAction = 'replace' | 'patch' | 'skip'

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

async function checkLocalModifications(
  projectRoot: string,
  packageName: string,
  agents: string[],
  scope: Scope = 'project',
  packageType?: string
): Promise<boolean> {
  const lockfile = readLockfile(projectRoot, scope)
  const lockEntry = lockfile.packages[packageName]
  if (!lockEntry) return false

  const shortName = packageName.split('/').pop()!

  if (packageType === 'AGENT' || packageType === 'COMMAND') {
    const getPlacementPath = packageType === 'AGENT' ? getAgentPlacementPath : getCommandPlacementPath
    const fileName = `${shortName}.md`
    for (const agentId of agents) {
      const placementPath = getPlacementPath(agentId as AgentId, fileName, scope)
      if (!placementPath) continue
      const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
      if (!fullPath) continue
      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath, 'utf-8')
          const localIntegrity = computeSha256FromFiles([{ path: fileName, content }])
          return localIntegrity !== lockEntry.integrity
        } catch {
          return false
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
  installedPath?: string
): Promise<{ commitSha: string } | null> {
  const lockfile = readLockfile(projectRoot, scope)
  const lockEntry = lockfile.packages[update.name]
  if (!lockEntry) return null

  const shortName = update.name.split('/').pop()!

  spinner.text = `Fetching original files for ${update.name} at locked commit...`

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
    const fetchResult = await fetchFiles(lockedResolved)
    baseFiles = fetchResult.files.map((f) => ({ path: f.path, content: f.content }))
  } catch (error) {
    spinner.warn(
      `Could not fetch original files for ${update.name}: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }

  const localFileArrays: Array<{ path: string; content: string }> = []
  const readPath = resolveReadPath(projectRoot, shortName, agents, scope)
  if (readPath) {
    try {
      const files = await readFilesFromDirectory(readPath)
      localFileArrays.push(...files.map((f) => ({ path: f.path, content: f.content })))
    } catch {
      // Best-effort read
    }
  }

  spinner.text = `Generating patch for ${update.name}...`

  const patchContent = generatePatch(baseFiles, localFileArrays, update.name)

  if (!patchContent || patchContent.trim() === '') {
    spinner.info(
      `No meaningful differences found for ${update.name}, proceeding with standard update.`
    )
    return null
  }

  const patchPath = savePatch(projectRoot, update.name, patchContent)
  spinner.text = `Patch saved to ${patchPath}`

  spinner.text = `Applying upstream update for ${update.name}...`

  const sourceUrl = update.sourcePath
    ? `${update.sourceUri}/${update.sourcePath}@${update.ref}`
    : `${update.sourceUri}@${update.ref}`

  const result = await installPackage(sourceUrl, {
    ...(agents.length > 0 ? { agent: agents } : {}),
    ...(scope === 'global' ? { global: true } : {}),
    ...(installedPath ? { path: installedPath } : {}),
  })

  spinner.text = `Reapplying local patch for ${update.name}...`

  try {
    const skillDir =
      resolveReadPath(projectRoot, shortName, agents, scope) ??
      getCanonicalSkillPath(projectRoot, shortName, scope)
    const applyResult = applyPatch(skillDir, patchContent)

    if (applyResult.applied) {
      removePatch(projectRoot, update.name)
      spinner.succeed(`${chalk.green(update.name)}: updated and local patch reapplied successfully`)
    } else {
      spinner.warn(
        `${chalk.yellow(update.name)}: updated but patch had conflicts in: ${applyResult.conflicts.join(', ')}`
      )
      console.log(chalk.dim(`  Patch saved at: ${patchPath}`))
      console.log(chalk.dim('  Review the patch file and apply remaining changes manually.'))
    }
  } catch (error) {
    spinner.warn(
      `${chalk.yellow(update.name)}: updated but could not reapply patch: ${error instanceof Error ? error.message : String(error)}`
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
    .option('--global', 'Update skills installed at user level (~/.agents/skills/)')
    .action(async (name: string | undefined, options: { dryRun?: boolean; global?: boolean }) => {
      const jsonMode = isJSONMode()
      const projectRoot = process.cwd()
      const scope = options.global ? 'global' : 'project'
      const manifest = readManifest(projectRoot, scope)
      const packages = name ? { [name]: manifest.packages[name] } : manifest.packages

      const packageNames = Object.keys(packages).filter((n) => packages[n])

      if (packageNames.length === 0) {
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
      const updatable = packageNames.filter((n) => {
        const pkg = packages[n]
        if (!pkg) return false
        if (pkg.pinned === true) {
          pinnedNames.push(n)
          return false
        }
        return pkg.source.type === 'git' && pkg.source.uri !== 'unknown'
      })

      if (pinnedNames.length > 0 && !jsonMode) {
        for (const pinnedName of pinnedNames) {
          console.log(chalk.dim(`Skipping ${pinnedName} (pinned)`))
        }
      }

      if (updatable.length === 0) {
        if (jsonMode) {
          outputSuccess<UpdateResult>({
            updated: [],
            skipped: [
              ...pinnedNames.map((n) => ({ name: n, reason: 'pinned' })),
              ...packageNames
                .filter((n) => !pinnedNames.includes(n))
                .map((n) => ({ name: n, reason: 'No known Git source' })),
            ],
          })
          return
        }
        if (pinnedNames.length === 0) {
          console.log(
            chalk.dim(
              'No packages with known Git sources. Reinstall packages using Git source URLs to enable updates.'
            )
          )
        }
        return
      }

      const spinner = createSpinner('Checking for upstream changes...').start()

      try {
        const updates: UpdateInfo[] = []

        for (const pkgName of updatable) {
          const pkg = packages[pkgName]!
          if (pkg.source.type !== 'git') continue

          const { uri, path, ref, commit: currentCommit } = pkg.source

          const cliSource = parseUriToCliSource(uri, path, ref)
          if (!cliSource) continue

          try {
            const resolved = await resolveRef(cliSource)

            if (resolved.commitSha !== currentCommit) {
              const locallyModified = await checkLocalModifications(
                projectRoot,
                pkgName,
                pkg.agents,
                scope,
                pkg.packageType
              )

              updates.push({
                name: pkgName,
                currentCommit,
                latestCommit: resolved.commitSha,
                ref,
                sourceUri: uri,
                sourcePath: path,
                locallyModified,
              })
            }
          } catch {
            spinner.warn(`Could not check upstream for ${pkgName}`)
          }
        }

        spinner.stop()

        if (updates.length === 0) {
          if (jsonMode) {
            outputSuccess<UpdateResult>({ updated: [], skipped: [] })
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
              `  ${chalk.green(update.name)}: ${chalk.dim(update.currentCommit.slice(0, 7))} \u2192 ${chalk.cyan(update.latestCommit.slice(0, 7))} ${chalk.dim(`(${update.ref})`)}${modifiedIndicator}`
            )
          }

          console.log()
        }

        if (options.dryRun) {
          if (jsonMode) {
            outputSuccess<UpdateResult>({
              updated: [],
              skipped: updates.map((u) => ({ name: u.name, reason: 'dry-run' })),
            })
            return
          }
          console.log(`${chalk.yellow('[dry-run]')} No changes made.`)
          return
        }

        if (!jsonMode) {
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
          const installedPkg = manifest.packages[update.name]
          const agents = installedPkg?.agents ?? []
          const installedPath = installedPkg?.path

          if (update.locallyModified) {
            let action: UpdateAction

            if (jsonMode) {
              action = 'replace'
            } else {
              action = await promptUpdateAction(update.name)
            }

            if (action === 'skip') {
              skipped.push(update.name)
              jsonSkipped.push({ name: update.name, reason: 'User skipped (locally modified)' })
              continue
            }

            if (action === 'patch') {
              const updateSpinner = createSpinner(
                `Processing patch update for ${update.name}...`
              ).start()

              try {
                const patchResult = await handlePatchUpdate(
                  update,
                  projectRoot,
                  agents,
                  updateSpinner,
                  scope,
                  installedPath
                )

                if (patchResult) {
                  results.push({
                    name: update.name,
                    from: update.currentCommit.slice(0, 7),
                    to: patchResult.commitSha.slice(0, 7),
                    patched: true,
                  })
                  jsonUpdated.push({
                    name: update.name,
                    fromRef: update.currentCommit.slice(0, 7),
                    toRef: patchResult.commitSha.slice(0, 7),
                    strategy: 'patch',
                  })
                  continue
                }
              } catch (error) {
                updateSpinner.fail(
                  `Patch update failed for ${update.name}: ${error instanceof Error ? error.message : String(error)}`
                )
                failures.push({
                  name: update.name,
                  error: error instanceof Error ? error.message : String(error),
                })
                jsonSkipped.push({
                  name: update.name,
                  reason: `Patch failed: ${error instanceof Error ? error.message : String(error)}`,
                })
                continue
              }
            }
          }

          const shortName = update.name.split('/').pop()!
          const placementPath = agents[0]
            ? getSkillPlacementPath(agents[0] as AgentId, shortName, scope)
            : null
          const fallbackDir = placementPath
            ? resolvePlacementPath(placementPath, projectRoot, scope)
            : null
          const skillDir = resolveReadPath(projectRoot, shortName, agents, scope) ?? fallbackDir

          let backup: BackupState | null = null

          try {
            backup = createBackup(update.name, projectRoot, skillDir, scope)

            const sourceUrl = update.sourcePath
              ? `${update.sourceUri}/${update.sourcePath}@${update.ref}`
              : `${update.sourceUri}@${update.ref}`

            const result = await installPackage(sourceUrl, {
              ...(agents.length > 0 ? { agent: agents } : {}),
              ...(scope === 'global' ? { global: true } : {}),
              ...(installedPath ? { path: installedPath } : {}),
            })

            cleanupBackup(backup)

            results.push({
              name: update.name,
              from: update.currentCommit.slice(0, 7),
              to: result.commitSha.slice(0, 7),
            })
            jsonUpdated.push({
              name: update.name,
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
              name: update.name,
              error: error instanceof Error ? error.message : String(error),
            })
            jsonSkipped.push({
              name: update.name,
              reason: `Failed: ${error instanceof Error ? error.message : String(error)}`,
            })
          }
        }

        if (jsonMode) {
          outputSuccess<UpdateResult>({
            updated: jsonUpdated,
            skipped: [...pinnedNames.map((n) => ({ name: n, reason: 'pinned' })), ...jsonSkipped],
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
    })
}
