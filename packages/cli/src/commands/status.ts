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
  agents: string[]
): Promise<Array<{ path: string; content: string }>> {
  // Try canonical path first, fall back to agent-specific paths
  const readPath = resolveReadPath(projectRoot, packageName, agents)
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
  offline: boolean
): Promise<PackageStatus> {
  const { source, agents, pinned } = manifestEntry

  // Well-known sources: only check local modification (no git upstream)
  if (source.type === 'well-known') {
    let locallyModified = false

    try {
      const localFiles = await readLocalFiles(projectRoot, name, agents)
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
    const localFiles = await readLocalFiles(projectRoot, name, agents)

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
    .description('Show status of installed skills (upstream changes, local modifications)')
    .option('--offline', 'Skip upstream checks')
    .option('--json', 'Output as JSON')
    .action(async (options: { offline?: boolean; json?: boolean }) => {
      const jsonMode = isJSONMode() || options.json === true
      const projectRoot = process.cwd()
      const manifest = readManifest(projectRoot)
      const lockfile = readLockfile(projectRoot)
      const entries = Object.entries(manifest.packages)

      if (entries.length === 0) {
        if (jsonMode) {
          outputSuccess(toStatusResult(buildStatusOutput([])))
        } else {
          console.log(chalk.dim('No packages installed.'))
        }
        return
      }

      const spinner = createSpinner('Checking package status...').start()

      const statuses: PackageStatus[] = []

      for (const [name, pkg] of entries) {
        spinner.text = `Checking ${name}...`

        const lockfileEntry = lockfile.packages[name]
        const status = await checkPackageStatus(
          projectRoot,
          name,
          pkg,
          lockfileEntry?.integrity,
          options.offline ?? false
        )
        statuses.push(status)
      }

      spinner.stop()

      if (jsonMode) {
        outputSuccess(toStatusResult(buildStatusOutput(statuses)))
        return
      }

      console.log(chalk.bold(`\nInstalled skills (${statuses.length}):\n`))

      for (const status of statuses) {
        console.log(formatStatusLine(status))
      }

      console.log()
    })
}
