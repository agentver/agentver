import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname } from 'node:path'
import type { ScannedFile } from '@agentver/agent-definitions'
import { scanForSkillFiles, scanGlobalSkillFiles } from '@agentver/agent-definitions'
import type {
  AdoptResult,
  LocalSource,
  ManifestV2,
  PackageSource,
  GitSource as SharedGitSource,
} from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { readFilesFromDirectory } from '../git/fetcher.js'
import {
  createGitRepoCache,
  type LocalGitContext,
  resolveLocalGitContext,
} from '../git/local-context.js'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { computeSha256FromFiles } from '../storage/integrity'
import { readManifest } from '../storage/manifest'
import {
  resolvePackageQuery,
  setLockfilePackage,
  setManifestPackage,
} from '../storage/package-identity'
import { updateManifestAndLockfile } from '../storage/pair'
import { migrateSkills } from './migrate.js'

export type AdoptOptions = {
  global?: boolean
  name?: string
  dryRun?: boolean
  reclassify?: boolean
  preferRemote?: string
  canonicalise?: boolean
}

type AdoptedEntry = {
  name: string
  path: string
  type: string
  agents: string[]
  sourceInfo?: string
  modified?: boolean
}

type SkippedEntry = {
  name: string
  path: string
  reason: string
}

type ReclassifiedEntry = {
  name: string
  oldType: string
  newUri: string
}

export type DeduplicatedFile = {
  path: string
  name: string
  detectedType: ScannedFile['detectedType']
  agents: string[]
}

type PendingAdoption = {
  name: string
  path: string
  type: string
  agents: string[]
  manifestEntry: {
    source: PackageSource
    agents: string[]
    installedAt: string
    modified: boolean
    packageType?: ManifestV2['packages'][string]['packageType']
    entryFile?: ManifestV2['packages'][string]['entryFile']
  }
  lockfileEntry: {
    source: PackageSource
    integrity: string
    agents: string[]
  }
}

export function deduplicateByPath(files: ScannedFile[]): DeduplicatedFile[] {
  const byPath = new Map<string, DeduplicatedFile>()

  for (const file of files) {
    const existing = byPath.get(file.path)
    if (existing) {
      if (!existing.agents.includes(file.agentId)) {
        existing.agents.push(file.agentId)
      }
    } else {
      byPath.set(file.path, {
        path: file.path,
        name: file.name,
        detectedType: file.detectedType,
        agents: [file.agentId],
      })
    }
  }

  return [...byPath.values()]
}

/**
 * Compute integrity from all files in a directory.
 * Uses the same multi-file hashing as install for consistency.
 * For single-file types (AGENT_CONFIG, AGENT, COMMAND), reads only the entry
 * file directly to avoid recursing into large agent home directories.
 */
export async function computeAdoptedIntegrity(
  entryFilePath: string,
  detectedType: ScannedFile['detectedType']
): Promise<string> {
  if (detectedType === 'AGENT' || detectedType === 'COMMAND' || detectedType === 'AGENT_CONFIG') {
    try {
      const entryFileName = basename(entryFilePath)
      const content = readFileSync(entryFilePath, 'utf-8')
      return computeSha256FromFiles([{ path: entryFileName, content }])
    } catch {
      return computeSha256FromFiles([{ path: basename(entryFilePath), content: '' }])
    }
  }

  const dirPath = dirname(entryFilePath)
  try {
    const files = await readFilesFromDirectory(dirPath)
    if (files.length === 0) {
      return computeSha256FromFiles([{ path: entryFilePath, content: '' }])
    }
    return computeSha256FromFiles(files)
  } catch {
    return computeSha256FromFiles([{ path: entryFilePath, content: '' }])
  }
}

/**
 * Build the appropriate source record from local git context.
 */
export function buildAdoptSource(
  context: LocalGitContext | null,
  fallbackPath: string
): { source: PackageSource; modified: boolean; sourceInfo: string } {
  // Case 1: Not in a git repo at all
  if (!context) {
    return {
      source: {
        type: 'local',
        path: fallbackPath,
      } satisfies LocalSource,
      modified: false,
      sourceInfo: 'local (not in a git repo)',
    }
  }

  // Case 2: In a git repo but no remote configured
  if (!context.remoteUri) {
    return {
      source: {
        type: 'local',
        path: fallbackPath,
      } satisfies LocalSource,
      modified: context.dirty,
      sourceInfo: 'local (no git remote)',
    }
  }

  // Case 3: Full git context available
  const shortCommit = context.commit.slice(0, 7)

  return {
    source: {
      type: 'git',
      uri: context.remoteUri,
      path: context.relativePath,
      ref: context.ref,
      commit: context.commit,
    } satisfies SharedGitSource,
    modified: context.dirty,
    sourceInfo: `${context.remoteUri} \u2192 ${context.ref}@${shortCommit}`,
  }
}

export async function adoptSkills(path: string | undefined, options: AdoptOptions): Promise<void> {
  const jsonMode = isJSONMode()
  const spinner = createSpinner('Scanning for skills...').start()

  try {
    const targetPath = path ?? process.cwd()
    const projectRoot = process.cwd()
    const home = homedir()

    // Handle reclassify mode
    if (options.reclassify) {
      spinner.text = 'Reclassifying local entries...'
      const reclassified = await reclassifyLocalEntries(projectRoot, options.preferRemote)

      if (jsonMode) {
        outputSuccess<AdoptResult>({ adopted: [], skipped: [] }, [
          ...reclassified.map((r) => `Reclassified ${r.name}: ${r.oldType} \u2192 ${r.newUri}`),
        ])
        return
      }

      spinner.stop()

      if (reclassified.length === 0) {
        process.stdout.write(chalk.dim('\nNo local entries to reclassify.\n'))
        return
      }

      process.stdout.write(chalk.bold('\nReclassified:\n'))
      for (const entry of reclassified) {
        process.stdout.write(
          `  ${chalk.green('\u2713')} ${chalk.green(entry.name.padEnd(16))} ${chalk.dim(entry.oldType)} ${chalk.dim('\u2192')} ${chalk.cyan(entry.newUri)}\n`
        )
      }

      process.stdout.write(
        chalk.dim(
          `\nReclassified ${reclassified.length} entr${reclassified.length === 1 ? 'y' : 'ies'}.\n`
        )
      )
      return
    }

    // Collect scanned files
    const projectFiles = scanForSkillFiles(targetPath)
    const seenPaths = new Set(projectFiles.map((f) => f.path))

    let allFiles: ScannedFile[] = [...projectFiles]

    if (options.global) {
      const globalFiles = scanGlobalSkillFiles(home)
      for (const gf of globalFiles) {
        if (!seenPaths.has(gf.path)) {
          allFiles.push(gf)
          seenPaths.add(gf.path)
        }
      }
    }

    // Filter by name if --name provided
    if (options.name) {
      allFiles = allFiles.filter((f) => f.name === options.name)
      if (allFiles.length === 0) {
        if (jsonMode) {
          outputError('NOT_FOUND', `No skill found matching name "${options.name}"`)
          process.exit(1)
        }
        spinner.fail(`No skill found matching name "${options.name}"`)
        process.exit(1)
      }
    }

    if (allFiles.length === 0) {
      if (jsonMode) {
        outputSuccess<AdoptResult>({ adopted: [], skipped: [] }, [
          'No skills or configs found to adopt.',
        ])
        return
      }
      spinner.warn('No skills or configs found to adopt.')
      return
    }

    // Deduplicate files by path, merging agents for the same file
    const deduped = deduplicateByPath(allFiles)

    const manifest = readManifest(projectRoot)
    const adopted: AdoptedEntry[] = []
    const skipped: SkippedEntry[] = []
    const pendingAdoptions: PendingAdoption[] = []

    const gitCache = createGitRepoCache()

    for (const file of deduped) {
      // Check if already in manifest
      const existing = resolvePackageQuery(manifest.packages, file.name)
      if (existing.ok) {
        skipped.push({
          name: file.name,
          path: file.path,
          reason: 'Already managed by Agentver',
        })
        continue
      }

      const isConfig = file.detectedType === 'AGENT_CONFIG'
      const sourcePath = isConfig ? file.path : dirname(file.path)

      // Resolve git context
      const gitContext = await resolveLocalGitContext(sourcePath, gitCache, options.preferRemote)
      const { source, modified, sourceInfo } = buildAdoptSource(gitContext, sourcePath)

      // Compute full-package integrity
      const integrity = await computeAdoptedIntegrity(file.path, file.detectedType)
      const entryFile =
        file.detectedType === 'AGENT' || file.detectedType === 'COMMAND'
          ? basename(file.path)
          : undefined
      const packageType =
        file.detectedType === 'SKILL'
          ? undefined
          : (file.detectedType as ManifestV2['packages'][string]['packageType'])

      if (!options.dryRun) {
        pendingAdoptions.push({
          name: file.name,
          path: file.path,
          type: file.detectedType,
          agents: file.agents,
          manifestEntry: {
            source,
            agents: file.agents,
            installedAt: new Date().toISOString(),
            modified,
            packageType,
            entryFile,
          },
          lockfileEntry: {
            source,
            integrity,
            agents: file.agents,
          },
        })
      }

      adopted.push({
        name: file.name,
        path: file.path,
        type: file.detectedType,
        agents: file.agents,
        sourceInfo,
        modified,
      })
    }

    if (!options.dryRun && pendingAdoptions.length > 0) {
      const committedNames = new Set<string>()

      updateManifestAndLockfile(projectRoot, 'project', (currentManifest, currentLockfile) => {
        for (const adoption of pendingAdoptions) {
          const existing = resolvePackageQuery(currentManifest.packages, adoption.name)
          if (existing.ok) {
            skipped.push({
              name: adoption.name,
              path: adoption.path,
              reason: 'Already managed by Agentver',
            })
            continue
          }

          setManifestPackage(currentManifest, adoption.name, adoption.manifestEntry)
          setLockfilePackage(currentLockfile, adoption.name, adoption.lockfileEntry)
          committedNames.add(adoption.name)
        }

        return { manifest: currentManifest, lockfile: currentLockfile }
      })

      if (committedNames.size !== pendingAdoptions.length) {
        const committedAdoptions = adopted.filter((entry) => committedNames.has(entry.name))
        adopted.length = 0
        adopted.push(...committedAdoptions)
      }
    }

    // Output results
    if (jsonMode) {
      if (options.canonicalise && adopted.length > 0) {
        for (const entry of adopted) {
          await migrateSkills(entry.name, {
            yes: true,
            global: options.global,
            dryRun: options.dryRun,
            silent: true,
          })
        }
      }
      outputSuccess<AdoptResult>({ adopted, skipped })
      return
    }

    spinner.stop()

    if (options.dryRun) {
      process.stdout.write(chalk.yellow('\n[dry-run] ') + chalk.dim('No changes written.\n'))
    }

    if (adopted.length > 0) {
      process.stdout.write(chalk.bold('\nAdopted:\n'))
      for (const entry of adopted) {
        const typeLabel = entry.type === 'AGENT_CONFIG' ? chalk.dim(', config') : ''
        const agentList = entry.agents.join(', ')
        process.stdout.write(
          `  ${chalk.green('\u2713')} ${chalk.green(entry.name.padEnd(16))} ${chalk.dim(entry.path.padEnd(45))} ${chalk.cyan(`(${agentList}${typeLabel})`)}\n`
        )
        if (entry.sourceInfo) {
          process.stdout.write(`    ${chalk.dim('\u21b3')} ${chalk.dim(entry.sourceInfo)}\n`)
        }
        if (entry.modified) {
          process.stdout.write(
            `    ${chalk.yellow('\u26a0')} ${chalk.yellow('uncommitted changes \u2014 marked as modified')}\n`
          )
        }
      }
    }

    if (skipped.length > 0) {
      process.stdout.write(chalk.bold('\nSkipped:\n'))
      for (const entry of skipped) {
        process.stdout.write(
          `  ${chalk.dim('\u2013')} ${entry.name.padEnd(16)} ${chalk.dim(entry.reason)}\n`
        )
      }
    }

    // Canonicalise adopted skills if requested
    if (options.canonicalise && adopted.length > 0) {
      process.stdout.write(chalk.bold('\nCanonicalising adopted skills...\n'))
      for (const entry of adopted) {
        await migrateSkills(entry.name, {
          yes: true,
          global: options.global,
          dryRun: options.dryRun,
          silent: true,
        })
      }
    }

    const summary = `\nAdopted ${adopted.length} skill${adopted.length === 1 ? '' : 's'}, skipped ${skipped.length}.\n`
    process.stdout.write(chalk.dim(summary))
  } catch (error) {
    if (jsonMode) {
      outputError('ADOPT_FAILED', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    spinner.fail(`Failed to adopt: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

/**
 * Reclassify existing local entries when git provenance becomes available.
 * Scans the manifest for `local` source entries, checks if their paths
 * now have git context, and upgrades the source if possible.
 */
async function reclassifyLocalEntries(
  projectRoot: string,
  preferredRemote?: string
): Promise<ReclassifiedEntry[]> {
  const manifest = readManifest(projectRoot)
  const reclassified: ReclassifiedEntry[] = []
  const gitCache = createGitRepoCache()

  const localEntries: Array<{ key: string; name: string; path: string }> = []

  for (const [key, pkg] of Object.entries(manifest.packages)) {
    if (pkg.source.type !== 'local') continue
    const displayName = pkg.name ?? key
    localEntries.push({ key, name: displayName, path: pkg.source.path })
  }

  if (localEntries.length === 0) {
    return []
  }

  // Resolve git context for each local entry
  const updates: Array<{
    key: string
    name: string
    newSource: SharedGitSource
    dirty: boolean
  }> = []

  for (const entry of localEntries) {
    const context = await resolveLocalGitContext(entry.path, gitCache, preferredRemote)
    if (!context?.remoteUri) continue

    updates.push({
      key: entry.key,
      name: entry.name,
      newSource: {
        type: 'git',
        uri: context.remoteUri,
        path: context.relativePath,
        ref: context.ref,
        commit: context.commit,
      },
      dirty: context.dirty,
    })
  }

  if (updates.length === 0) {
    return []
  }

  updateManifestAndLockfile(projectRoot, 'project', (currentManifest, currentLockfile) => {
    for (const update of updates) {
      const manifestPkg = currentManifest.packages[update.key]
      const lockfilePkg = currentLockfile.packages[update.key]

      if (manifestPkg) {
        delete currentManifest.packages[update.key]
        setManifestPackage(currentManifest, update.name, {
          ...manifestPkg,
          source: update.newSource,
          ...(update.dirty ? { modified: true } : {}),
        })
      }

      if (lockfilePkg) {
        delete currentLockfile.packages[update.key]
        setLockfilePackage(currentLockfile, update.name, {
          ...lockfilePkg,
          source: update.newSource,
        })
      }

      reclassified.push({
        name: update.name,
        oldType: 'local',
        newUri: update.newSource.uri,
      })
    }

    return { manifest: currentManifest, lockfile: currentLockfile }
  })

  return reclassified
}

export function registerAdoptCommand(program: Command): void {
  program
    .command('adopt [path]')
    .description('Adopt existing skills and configs into Agentver management')
    .option('--global', 'Also scan global paths (~/.claude/skills, etc.)')
    .option('--name <name>', 'Adopt a specific skill by name')
    .option('--dry-run', 'Show what would be adopted without making changes')
    .option('--reclassify', 'Re-resolve git context for existing local entries')
    .option('--prefer-remote <name>', 'Prefer a specific remote name (default: origin)')
    .option('--canonicalise', 'Move adopted skills into canonical .agents/ storage with symlinks')
    .action(async (path: string | undefined, options: AdoptOptions) => {
      await adoptSkills(path, options)
    })
}
