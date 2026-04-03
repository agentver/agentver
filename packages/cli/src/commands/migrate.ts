import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import { AgentverError } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import prompts from 'prompts'
import {
  createSpinner,
  isJSONMode,
  outputError,
  outputSuccess,
  type SpinnerLike,
} from '../output.js'
import {
  type CanonicalCategory,
  createAgentSymlinks,
  createFileSymlinks,
  findAgentSkillPlacementConflicts,
  getCanonicalFilePath,
  getCanonicalSkillPath,
  getFilePlacementPath,
  removeAgentSymlinks,
  removeFileSymlinks,
  resolveReadPath,
} from '../storage/canonical.js'
import { readManifest } from '../storage/manifest.js'
import { updateManifestAndLockfile } from '../storage/pair.js'
import { cleanupBackup, createFilesystemBackup, restoreFilesystemBackup } from '../utils/backup.js'
import { resolvePlacementPath, type Scope } from '../utils/paths'
import { extractError } from '../utils.js'

type MigrateOptions = {
  global?: boolean
  dryRun?: boolean
  yes?: boolean
  silent?: boolean
}

export type MigrationResult = {
  migrated: Array<{ name: string; from: string; to: string }>
  skipped: Array<{ name: string; reason: string }>
}

const PACKAGE_TYPE_TO_CATEGORY: Record<string, CanonicalCategory> = {
  AGENT: 'agents',
  COMMAND: 'commands',
}

const noopSpinnerLike: SpinnerLike = {
  start() {
    return this
  },
  succeed() {
    return this
  },
  fail() {
    return this
  },
  warn() {
    return this
  },
  info() {
    return this
  },
  stop() {
    return this
  },
  text: '',
}

function isSingleFilePackageType(
  packageType: string | undefined
): packageType is 'AGENT' | 'COMMAND' {
  return packageType === 'AGENT' || packageType === 'COMMAND'
}

function getExistingFilePaths(
  projectRoot: string,
  packageName: string,
  agents: string[],
  category: CanonicalCategory,
  scope: Scope
): string[] {
  const paths = new Set<string>()

  for (const agentId of agents) {
    const placementPath = getFilePlacementPath(agentId as AgentId, packageName, category, scope)
    if (!placementPath) continue

    const resolvedPath = resolvePlacementPath(placementPath, projectRoot, scope)
    if (!resolvedPath || !existsSync(resolvedPath)) continue

    paths.add(resolvedPath)
  }

  return [...paths]
}

function getExistingSkillPaths(
  projectRoot: string,
  packageName: string,
  agents: string[],
  scope: Scope
): string[] {
  const paths = new Set<string>()

  for (const agentId of agents) {
    const placementPath = getSkillPlacementPath(agentId as AgentId, packageName, scope)
    if (!placementPath) continue

    const resolvedPath = resolvePlacementPath(placementPath, projectRoot, scope)
    if (!resolvedPath || !existsSync(resolvedPath)) continue

    paths.add(resolvedPath)
  }

  return [...paths]
}

async function confirmMigration(
  packageName: string,
  sourcePath: string,
  canonicalPath: string,
  options: MigrateOptions
): Promise<void> {
  const message = `Migrate ${packageName} from ${sourcePath} to ${canonicalPath} and replace agent paths with symlinks?`

  if (isJSONMode() && !options.yes) {
    throw new AgentverError('CONFIRMATION_REQUIRED', `${message} Re-run with --yes to continue.`)
  }

  if (!isJSONMode() && !options.yes) {
    const { proceed } = await prompts({
      type: 'confirm',
      name: 'proceed',
      message,
      initial: true,
    })

    if (!proceed) {
      throw new AgentverError('CANCELLED', 'Migration cancelled by user')
    }
  }
}

export async function migrateSkills(
  name: string | undefined,
  options: MigrateOptions
): Promise<MigrationResult> {
  const jsonMode = isJSONMode()
  const silent = options.silent === true
  const projectRoot = process.cwd()
  const scope: Scope = options.global ? 'global' : 'project'
  const manifest = readManifest(projectRoot, scope)
  const spinner = silent
    ? noopSpinnerLike.start()
    : createSpinner('Inspecting installed packages...').start()

  try {
    const packageEntries = Object.entries(manifest.packages).filter(([packageName, pkg]) => {
      if (name && packageName !== name) return false
      if (pkg.path) return false
      return true
    })

    if (name && packageEntries.length === 0) {
      throw new AgentverError('NOT_FOUND', `Package "${name}" is not installed.`)
    }

    const result: MigrationResult = { migrated: [], skipped: [] }

    for (const [packageName, pkg] of packageEntries) {
      const shortName = (pkg.name ?? packageName).split('/').pop() ?? packageName
      const singleFile = isSingleFilePackageType(pkg.packageType)
      const category = singleFile ? PACKAGE_TYPE_TO_CATEGORY[pkg.packageType as string] : undefined

      if (
        pkg.packageType &&
        pkg.packageType !== 'SKILL' &&
        !isSingleFilePackageType(pkg.packageType)
      ) {
        result.skipped.push({
          name: packageName,
          reason: `Package type ${pkg.packageType} cannot be migrated`,
        })
        continue
      }

      const canonicalPath =
        singleFile && category
          ? getCanonicalFilePath(projectRoot, shortName, category, scope)
          : getCanonicalSkillPath(projectRoot, shortName, scope)

      const readPath =
        singleFile && category
          ? resolveReadPath(projectRoot, shortName, pkg.agents, scope, category)
          : resolveReadPath(projectRoot, shortName, pkg.agents, scope)

      if (!readPath) {
        result.skipped.push({
          name: packageName,
          reason: singleFile ? 'No local package file found' : 'No local skill files found',
        })
        continue
      }

      if (readPath === canonicalPath) {
        result.skipped.push({ name: packageName, reason: 'Already using canonical storage' })
        continue
      }

      if (existsSync(canonicalPath)) {
        result.skipped.push({
          name: packageName,
          reason: `Canonical path already exists at ${canonicalPath}`,
        })
        continue
      }

      if (!singleFile) {
        const existingSkillPaths = getExistingSkillPaths(projectRoot, shortName, pkg.agents, scope)
        const unmanagedConflicts = findAgentSkillPlacementConflicts(
          projectRoot,
          shortName,
          pkg.agents,
          scope
        )

        const conflictingPaths = new Set(
          unmanagedConflicts.map((conflict) => conflict.path).filter((path) => path !== readPath)
        )
        const distinctPaths = new Set(existingSkillPaths.filter((path) => path !== canonicalPath))

        if (conflictingPaths.size > 0 || distinctPaths.size > 1) {
          result.skipped.push({
            name: packageName,
            reason: 'Found multiple existing skill directories; migrate this package manually',
          })
          continue
        }
      } else if (category) {
        const existingPaths = getExistingFilePaths(
          projectRoot,
          shortName,
          pkg.agents,
          category,
          scope
        )
        const distinctPaths = new Set(existingPaths.filter((path) => path !== canonicalPath))

        if (distinctPaths.size > 1) {
          result.skipped.push({
            name: packageName,
            reason: 'Found multiple existing files; migrate this package manually',
          })
          continue
        }
      }

      if (options.dryRun) {
        result.migrated.push({ name: packageName, from: readPath, to: canonicalPath })
        continue
      }

      await confirmMigration(packageName, readPath, canonicalPath, options)

      const backup = createFilesystemBackup([readPath])

      try {
        spinner.text = `Migrating ${packageName}...`

        mkdirSync(dirname(canonicalPath), { recursive: true })

        if (singleFile && category) {
          copyFileSync(readPath, canonicalPath)
          unlinkSync(readPath)
          createFileSymlinks(projectRoot, shortName, category, pkg.agents, scope)
        } else {
          cpSync(readPath, canonicalPath, { recursive: true, dereference: true })
          rmSync(readPath, { recursive: true, force: true })
          createAgentSymlinks(projectRoot, shortName, pkg.agents, scope)
        }

        updateManifestAndLockfile(projectRoot, scope, (currentManifest, currentLockfile) => {
          const manifestEntry = currentManifest.packages[packageName]
          const lockfileEntry = currentLockfile.packages[packageName]

          // For single-file packages, source.path is the parent directory,
          // not the full file path, so also compare against dirname(readPath).
          const isLocalMatch = (sourcePath: string) =>
            sourcePath === readPath || (singleFile && sourcePath === dirname(readPath))

          // Single-file packages store the directory in source.path (filename
          // lives in entryFile), so point to the canonical directory rather
          // than the full file path.
          const newSourcePath = singleFile ? dirname(canonicalPath) : canonicalPath

          if (manifestEntry?.source.type === 'local' && isLocalMatch(manifestEntry.source.path)) {
            manifestEntry.source = {
              ...manifestEntry.source,
              path: newSourcePath,
            }
          }

          if (lockfileEntry?.source.type === 'local' && isLocalMatch(lockfileEntry.source.path)) {
            lockfileEntry.source = {
              ...lockfileEntry.source,
              path: newSourcePath,
            }
          }

          return { manifest: currentManifest, lockfile: currentLockfile }
        })

        cleanupBackup(backup)
        result.migrated.push({ name: packageName, from: readPath, to: canonicalPath })
      } catch (error) {
        restoreFilesystemBackup(backup)
        cleanupBackup(backup)
        rmSync(canonicalPath, { recursive: true, force: true })

        // Clean up any symlinks that were partially created before the error
        if (singleFile && category) {
          removeFileSymlinks(projectRoot, shortName, category, pkg.agents, scope)
        } else {
          removeAgentSymlinks(projectRoot, shortName, pkg.agents, scope)
        }

        result.skipped.push({
          name: packageName,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }

    spinner.stop()

    if (silent) {
      return result
    }

    if (jsonMode) {
      outputSuccess(result)
      return result
    }

    if (result.migrated.length > 0) {
      process.stdout.write(chalk.bold('\nMigrated:\n'))
      for (const item of result.migrated) {
        process.stdout.write(
          `  ${chalk.green('\u2713')} ${chalk.green(item.name)} ${chalk.dim(item.from)} ${chalk.cyan(`→ ${item.to}`)}\n`
        )
      }
    }

    if (result.skipped.length > 0) {
      process.stdout.write(chalk.bold('\nSkipped:\n'))
      for (const item of result.skipped) {
        process.stdout.write(`  ${chalk.dim('\u2013')} ${item.name} ${chalk.dim(item.reason)}\n`)
      }
    }

    return result
  } catch (error) {
    if (silent) {
      throw error
    }
    const { code, message } = extractError(error, 'MIGRATE_FAILED')
    if (jsonMode) {
      outputError(code, message)
    } else {
      spinner.fail(`Failed to migrate: ${message}`)
    }
    process.exit(1)
  }
}

export function registerMigrateCommand(program: Command): void {
  program
    .command('migrate [name]')
    .description(
      'Move managed packages into canonical storage and replace agent paths with symlinks'
    )
    .option('-y, --yes', 'Accept migration prompts non-interactively')
    .option('--global', 'Migrate globally installed packages')
    .option('--dry-run', 'Show what would be migrated without making changes')
    .action(async (name: string | undefined, options: MigrateOptions) => {
      await migrateSkills(name, options)
    })
}
