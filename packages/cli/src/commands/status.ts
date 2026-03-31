import { existsSync, readFileSync } from 'node:fs'
import {
  type AgentId,
  getAgentPlacementPath,
  getCommandPlacementPath,
} from '@agentver/agent-definitions'
import type { ManifestV2Package, StatusResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { readFilesFromDirectory } from '../git/fetcher.js'
import { resolveRef } from '../git/index.js'
import type { GitSource as CliGitSource } from '../git/types.js'
import { createSpinner, isJSONMode, outputSuccess } from '../output'
import { resolveReadPath } from '../storage/canonical.js'
import { computeSha256FromFiles } from '../storage/integrity.js'
import { readLockfile } from '../storage/lockfile.js'
import { readManifest } from '../storage/manifest.js'
import { resolvePlacementPath, type Scope } from '../utils/paths'

type StatusCategory = 'up-to-date' | 'modified' | 'upstream' | 'both' | 'unknown'

type PackageStatus = {
  name: string
  category: StatusCategory
  sourceUri: string
  ref: string
  commit: string
  upstreamCommit?: string
  agents: string[]
  pinned?: boolean
  error?: string
}

type StatusOutput = {
  packages: PackageStatus[]
  total: number
  modified: number
  upstream: number
  upToDate: number
  unknown: number
}

const STATUS_SYMBOLS: Record<StatusCategory, string> = {
  'up-to-date': chalk.green('✓'),
  modified: chalk.yellow('M'),
  upstream: chalk.cyan('U'),
  both: chalk.red('MU'),
  unknown: chalk.dim('?'),
}

const SCOPE_LABELS: Record<Scope, string> = {
  project: 'Project skills',
  global: 'User skills',
}

function resolveScopes(options: { global?: boolean; all?: boolean }): Scope[] {
  if (options.all) return ['project', 'global']
  if (options.global) return ['global']
  return ['project']
}

function parseManifestUri(uri: string): CliGitSource | null {
  const parts = uri.split('/')
  if (parts.length < 3) return null

  return {
    host: parts[0] as CliGitSource['host'],
    owner: parts[1]!,
    repo: parts[2]!,
    path: parts.slice(3).join('/'),
    ref: 'HEAD',
  }
}

async function readLocalFiles(
  projectRoot: string,
  packageName: string,
  agents: string[],
  scope: Scope = 'project',
  packageType?: string,
  entryFile?: string
): Promise<Array<{ path: string; content: string }>> {
  if (packageType === 'AGENT' || packageType === 'COMMAND') {
    const getPlacementPath =
      packageType === 'AGENT' ? getAgentPlacementPath : getCommandPlacementPath
    const shortName = packageName.split('/').pop()!
    const fileName = entryFile ?? `${shortName}.md`
    for (const agentId of agents) {
      const placementPath = getPlacementPath(agentId as AgentId, fileName, scope)
      if (!placementPath) continue
      const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
      if (!fullPath) continue
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, 'utf-8')
        return [{ path: fileName, content }]
      }
    }
    return []
  }

  const readPath = resolveReadPath(projectRoot, packageName, agents, scope)
  if (readPath) {
    const files = await readFilesFromDirectory(readPath)
    return files.map((f) => ({ path: f.path, content: f.content }))
  }

  return []
}

async function checkPackageStatus(
  projectRoot: string,
  name: string,
  manifestEntry: ManifestV2Package,
  lockfileIntegrity: string | undefined,
  offline: boolean,
  scope: Scope = 'project'
): Promise<PackageStatus> {
  const { source, agents, pinned, packageType, entryFile } = manifestEntry

  // Well-known sources: only check local modification (no git upstream)
  if (source.type === 'well-known') {
    let locallyModified = false

    try {
      const localFiles = await readLocalFiles(
        projectRoot,
        name,
        agents,
        scope,
        packageType,
        entryFile
      )
      if (lockfileIntegrity && localFiles.length > 0) {
        const localIntegrity = computeSha256FromFiles(localFiles)
        locallyModified = localIntegrity !== lockfileIntegrity
      }
    } catch {
      locallyModified = false
    }

    return {
      name,
      category: locallyModified ? 'modified' : 'up-to-date',
      sourceUri: source.hostname,
      ref: 'well-known',
      commit: '',
      agents,
      pinned: pinned || undefined,
    }
  }

  if (source.uri === 'unknown') {
    return {
      name,
      category: 'unknown',
      sourceUri: source.uri,
      ref: source.ref,
      commit: source.commit,
      agents,
      pinned: pinned || undefined,
    }
  }

  let locallyModified = false
  let upstreamChanged = false
  let upstreamCommit: string | undefined

  try {
    const localFiles = await readLocalFiles(
      projectRoot,
      name,
      agents,
      scope,
      packageType,
      entryFile
    )

    if (lockfileIntegrity && localFiles.length > 0) {
      const localIntegrity = computeSha256FromFiles(localFiles)
      locallyModified = localIntegrity !== lockfileIntegrity
    }
  } catch {
    locallyModified = false
  }

  if (!offline) {
    try {
      const cliSource = parseManifestUri(source.uri)
      if (cliSource) {
        cliSource.ref = source.ref
        const resolved = await resolveRef(cliSource)
        upstreamCommit = resolved.commitSha

        if (resolved.commitSha !== source.commit) {
          upstreamChanged = true
        }
      }
    } catch {
      // Network failure — skip upstream check silently
    }
  }

  let category: StatusCategory = 'up-to-date'
  if (locallyModified && upstreamChanged) {
    category = 'both'
  } else if (locallyModified) {
    category = 'modified'
  } else if (upstreamChanged) {
    category = 'upstream'
  }

  return {
    name,
    category,
    sourceUri: source.uri,
    ref: source.ref,
    commit: source.commit,
    upstreamCommit: upstreamChanged ? upstreamCommit : undefined,
    agents,
    pinned: pinned || undefined,
  }
}

function formatStatusLine(status: PackageStatus): string {
  const symbol = STATUS_SYMBOLS[status.category]
  const padding = status.category === 'both' ? '' : ' '

  if (status.category === 'unknown') {
    return `  ${symbol}  ${chalk.white(status.name)}  ${chalk.dim('unknown source')}`
  }

  const shortCommit = status.commit.slice(0, 7)
  const upstream = status.upstreamCommit
    ? ` ${chalk.dim('→')} ${chalk.cyan(`upstream: ${status.upstreamCommit.slice(0, 7)}`)}`
    : ''

  const pinned = status.pinned ? chalk.yellow(' [pinned]') : ''

  return `  ${symbol}${padding} ${chalk.white(status.name)}${pinned}  ${chalk.dim(status.sourceUri)}  ${chalk.cyan(`@${status.ref}`)} ${chalk.dim(`(${shortCommit})`)}${upstream}`
}

function buildStatusOutput(statuses: PackageStatus[]): StatusOutput {
  return {
    packages: statuses,
    total: statuses.length,
    modified: statuses.filter((s) => s.category === 'modified' || s.category === 'both').length,
    upstream: statuses.filter((s) => s.category === 'upstream' || s.category === 'both').length,
    upToDate: statuses.filter((s) => s.category === 'up-to-date').length,
    unknown: statuses.filter((s) => s.category === 'unknown').length,
  }
}

function toStatusResult(output: StatusOutput): StatusResult {
  return {
    packages: output.packages.map((p) => ({
      name: p.name,
      status: p.category,
      modified: p.category === 'modified' || p.category === 'both',
      upstream: p.category === 'upstream' || p.category === 'both',
      pinned: p.pinned || undefined,
    })),
    summary: {
      total: output.total,
      upToDate: output.upToDate,
      modified: output.modified,
      upstream: output.upstream,
      unknown: output.unknown,
    },
  }
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show status of installed packages (upstream changes, local modifications)')
    .option('--global', 'Check globally installed packages')
    .option('--all', 'Check both project and global packages')
    .option('--offline', 'Skip upstream checks')
    .option('--json', 'Output as JSON')
    .action(
      async (options: { global?: boolean; all?: boolean; offline?: boolean; json?: boolean }) => {
        const jsonMode = isJSONMode() || options.json === true
        const projectRoot = process.cwd()
        const scopes = resolveScopes(options)
        const multiScope = scopes.length > 1

        const allStatuses: PackageStatus[] = []
        const statusesByScope: Map<Scope, PackageStatus[]> = new Map()

        let hasPackages = false

        for (const scope of scopes) {
          const manifest = readManifest(projectRoot, scope)
          const lockfile = readLockfile(projectRoot, scope)
          const entries = Object.entries(manifest.packages)

          if (entries.length > 0) {
            hasPackages = true
          }

          const scopeStatuses: PackageStatus[] = []

          const spinner =
            !jsonMode && entries.length > 0
              ? createSpinner('Checking package status...').start()
              : null

          const statusResults = await Promise.allSettled(
            entries.map(async ([name, pkg]) => {
              if (spinner) spinner.text = `Checking ${name}...`

              const lockfileEntry = lockfile.packages[name]
              return checkPackageStatus(
                projectRoot,
                name,
                pkg,
                lockfileEntry?.integrity,
                options.offline ?? false,
                scope
              )
            })
          )

          for (const [index, result] of statusResults.entries()) {
            if (result.status === 'fulfilled') {
              scopeStatuses.push(result.value)
              allStatuses.push(result.value)
              continue
            }

            const [name, pkg] = entries[index]!
            const fallbackStatus: PackageStatus = {
              name,
              category: 'unknown',
              sourceUri: pkg.source.type === 'git' ? pkg.source.uri : pkg.source.hostname,
              ref: pkg.source.type === 'git' ? pkg.source.ref : 'well-known',
              commit: pkg.source.type === 'git' ? pkg.source.commit : '',
              agents: pkg.agents,
              pinned: pkg.pinned || undefined,
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            }
            scopeStatuses.push(fallbackStatus)
            allStatuses.push(fallbackStatus)
          }

          if (spinner) spinner.stop()

          statusesByScope.set(scope, scopeStatuses)
        }

        if (!hasPackages) {
          if (jsonMode) {
            outputSuccess(toStatusResult(buildStatusOutput([])))
          } else {
            console.log(chalk.dim('No packages installed.'))
          }
          return
        }

        if (jsonMode) {
          outputSuccess(toStatusResult(buildStatusOutput(allStatuses)))
          return
        }

        for (const scope of scopes) {
          const scopeStatuses = statusesByScope.get(scope) ?? []

          if (multiScope) {
            console.log(chalk.bold(`\n${SCOPE_LABELS[scope]} (${scopeStatuses.length}):\n`))
          } else {
            console.log(chalk.bold(`\nInstalled packages (${scopeStatuses.length}):\n`))
          }

          for (const status of scopeStatuses) {
            console.log(formatStatusLine(status))
          }
        }

        console.log()
      }
    )
}
