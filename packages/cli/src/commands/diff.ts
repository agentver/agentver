import type { DiffResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { readFilesFromDirectory } from '../git/fetcher.js'
import { fetchFiles } from '../git/index.js'
import type { GitSource as CliGitSource, ResolvedRef } from '../git/types.js'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output'
import type { PlatformResolveResponse } from '../registry/platform.js'
import { platformFetch } from '../registry/platform.js'
import { resolveReadPath } from '../storage/canonical.js'
import { readLockfile } from '../storage/lockfile.js'
import { readManifest } from '../storage/manifest.js'
import { resolvePackageQuery } from '../storage/package-identity.js'
import type { Scope } from '../utils/paths.js'
import { fetchWellKnownIndex, fetchWellKnownSkill } from '../wellknown/index.js'

const CONTEXT_LINES = 3

type DiffHunk = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: string[]
}

type FileDiff = {
  path: string
  type: 'added' | 'removed' | 'modified'
  hunks: DiffHunk[]
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

async function fetchPlatformFiles(source: {
  uri: string
  path: string
  ref: string
  commit: string
  expectedIntegrity?: string
}) {
  const org = source.uri.slice('agentver://'.length).trim()
  if (!org) {
    throw new Error(`Could not parse platform source URI: ${source.uri}`)
  }

  const resolveName = source.path ? `${org}/${source.path}` : org
  const resolved = await platformFetch<PlatformResolveResponse>(
    `/resolve?name=${encodeURIComponent(resolveName)}`
  )

  if (resolved.source === 'platform') {
    if (!resolved.files?.length) {
      throw new Error(`No files returned for platform source: ${resolveName}`)
    }

    return {
      files: resolved.files.map((file) => ({ path: file.path, content: file.content })),
    }
  }

  const cliSource = parseManifestUri(resolved.gitUri)
  if (!cliSource) {
    throw new Error(`Could not parse resolved Git URI: ${resolved.gitUri}`)
  }

  cliSource.path = resolved.gitPath ?? source.path
  cliSource.ref = resolved.gitRef ?? source.ref
  cliSource.commit = source.commit

  return fetchFiles(
    {
      source: cliSource,
      commitSha: source.commit,
    },
    { expectedIntegrity: source.expectedIntegrity }
  )
}

async function readLocalFiles(
  projectRoot: string,
  packageName: string,
  agents: string[],
  scope: Scope = 'project'
): Promise<Array<{ path: string; content: string }>> {
  // Try canonical path first, fall back to agent-specific paths
  const readPath = resolveReadPath(projectRoot, packageName, agents, scope)
  if (readPath) {
    const files = await readFilesFromDirectory(readPath)
    return files.map((f) => ({ path: f.path, content: f.content }))
  }

  return []
}

function computeHunks(oldLines: string[], newLines: string[]): DiffHunk[] {
  const lcs = computeLcs(oldLines, newLines)
  const changes = buildChangeList(oldLines, newLines, lcs)

  if (changes.length === 0) return []

  return groupIntoHunks(changes)
}

function computeLcs(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[])

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
      }
    }
  }

  const result: Array<[number, number]> = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift([i - 1, j - 1])
      i--
      j--
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i--
    } else {
      j--
    }
  }

  return result
}

type Change = {
  type: 'context' | 'add' | 'remove'
  oldIndex: number
  newIndex: number
  line: string
}

function buildChangeList(
  oldLines: string[],
  newLines: string[],
  lcs: Array<[number, number]>
): Change[] {
  const changes: Change[] = []
  let oldIdx = 0
  let newIdx = 0

  for (const [lcsOld, lcsNew] of lcs) {
    while (oldIdx < lcsOld) {
      changes.push({ type: 'remove', oldIndex: oldIdx, newIndex: newIdx, line: oldLines[oldIdx]! })
      oldIdx++
    }
    while (newIdx < lcsNew) {
      changes.push({ type: 'add', oldIndex: oldIdx, newIndex: newIdx, line: newLines[newIdx]! })
      newIdx++
    }
    changes.push({ type: 'context', oldIndex: oldIdx, newIndex: newIdx, line: oldLines[oldIdx]! })
    oldIdx++
    newIdx++
  }

  while (oldIdx < oldLines.length) {
    changes.push({ type: 'remove', oldIndex: oldIdx, newIndex: newIdx, line: oldLines[oldIdx]! })
    oldIdx++
  }
  while (newIdx < newLines.length) {
    changes.push({ type: 'add', oldIndex: oldIdx, newIndex: newIdx, line: newLines[newIdx]! })
    newIdx++
  }

  return changes
}

function groupIntoHunks(changes: Change[]): DiffHunk[] {
  const diffIndices: number[] = []
  for (let i = 0; i < changes.length; i++) {
    if (changes[i]!.type !== 'context') {
      diffIndices.push(i)
    }
  }

  if (diffIndices.length === 0) return []

  const hunks: DiffHunk[] = []
  let hunkStart = 0
  let groupStart = diffIndices[0]!

  for (let d = 0; d < diffIndices.length; d++) {
    const nextDiffIdx = diffIndices[d + 1]
    const currentDiffIdx = diffIndices[d]!

    const gapToNext = nextDiffIdx !== undefined ? nextDiffIdx - currentDiffIdx - 1 : Infinity

    if (gapToNext > CONTEXT_LINES * 2) {
      const contextBefore = Math.max(0, groupStart - CONTEXT_LINES)
      const contextAfter = Math.min(changes.length - 1, currentDiffIdx + CONTEXT_LINES)

      const hunkChanges = changes.slice(contextBefore, contextAfter + 1)
      const hunk = buildHunk(hunkChanges, contextBefore, changes)
      hunks.push(hunk)

      hunkStart = d + 1
      groupStart = nextDiffIdx ?? groupStart
    }
  }

  if (hunkStart <= diffIndices.length - 1) {
    const lastDiffIdx = diffIndices[diffIndices.length - 1]!
    const contextBefore = Math.max(0, groupStart - CONTEXT_LINES)
    const contextAfter = Math.min(changes.length - 1, lastDiffIdx + CONTEXT_LINES)

    const hunkChanges = changes.slice(contextBefore, contextAfter + 1)
    const hunk = buildHunk(hunkChanges, contextBefore, changes)
    hunks.push(hunk)
  }

  return hunks
}

function buildHunk(hunkChanges: Change[], startIdx: number, allChanges: Change[]): DiffHunk {
  let oldStart = 1
  let newStart = 1

  const firstChange = hunkChanges[0] ?? allChanges[startIdx]
  if (firstChange) {
    oldStart = firstChange.oldIndex + 1
    newStart = firstChange.newIndex + 1
  }

  let oldCount = 0
  let newCount = 0
  const lines: string[] = []

  for (const change of hunkChanges) {
    switch (change.type) {
      case 'context':
        lines.push(` ${change.line}`)
        oldCount++
        newCount++
        break
      case 'remove':
        lines.push(`-${change.line}`)
        oldCount++
        break
      case 'add':
        lines.push(`+${change.line}`)
        newCount++
        break
    }
  }

  return { oldStart, oldCount, newStart, newCount, lines }
}

function diffFiles(
  upstreamFiles: Map<string, string>,
  localFiles: Map<string, string>
): FileDiff[] {
  const diffs: FileDiff[] = []
  const allPaths = new Set([...upstreamFiles.keys(), ...localFiles.keys()])

  for (const path of [...allPaths].sort()) {
    const upstreamContent = upstreamFiles.get(path)
    const localContent = localFiles.get(path)

    if (upstreamContent === undefined && localContent !== undefined) {
      const newLines = localContent.split('\n')
      const hunks = computeHunks([], newLines)
      if (hunks.length > 0) {
        diffs.push({ path, type: 'added', hunks })
      }
      continue
    }

    if (upstreamContent !== undefined && localContent === undefined) {
      const oldLines = upstreamContent.split('\n')
      const hunks = computeHunks(oldLines, [])
      if (hunks.length > 0) {
        diffs.push({ path, type: 'removed', hunks })
      }
      continue
    }

    if (
      upstreamContent !== undefined &&
      localContent !== undefined &&
      upstreamContent !== localContent
    ) {
      const oldLines = upstreamContent.split('\n')
      const newLines = localContent.split('\n')
      const hunks = computeHunks(oldLines, newLines)
      if (hunks.length > 0) {
        diffs.push({ path, type: 'modified', hunks })
      }
    }
  }

  return diffs
}

function formatDiff(diffs: FileDiff[]): string {
  const output: string[] = []

  for (const diff of diffs) {
    output.push(chalk.bold(`--- a/${diff.path}`))
    output.push(chalk.bold(`+++ b/${diff.path}`))

    for (const hunk of diff.hunks) {
      output.push(
        chalk.cyan(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`)
      )

      for (const line of hunk.lines) {
        if (line.startsWith('+')) {
          output.push(chalk.green(line))
        } else if (line.startsWith('-')) {
          output.push(chalk.red(line))
        } else {
          output.push(line)
        }
      }
    }

    output.push('')
  }

  return output.join('\n')
}

export function registerDiffCommand(program: Command): void {
  program
    .command('diff <name>')
    .description('Show diff between local and upstream version of a skill')
    .option('--global', 'Diff a globally installed package')
    .action(async (name: string, options: { global?: boolean }) => {
      const jsonMode = isJSONMode()
      const scope: Scope = options.global ? 'global' : 'project'
      const projectRoot = process.cwd()
      const manifest = readManifest(projectRoot, scope)
      const lockfile = readLockfile(projectRoot, scope)
      const packageLookup = resolvePackageQuery(manifest.packages, name)

      if (!packageLookup.ok) {
        const otherScope: Scope = scope === 'project' ? 'global' : 'project'
        const otherManifest = readManifest(projectRoot, otherScope)
        const foundInOther = resolvePackageQuery(otherManifest.packages, name).ok

        const hint = foundInOther
          ? otherScope === 'global'
            ? `Found in global scope — try: agentver diff ${name} --global`
            : 'Found in project scope — try without --global'
          : undefined

        if (jsonMode) {
          const msg = hint
            ? `Package "${name}" is not installed. ${hint}`
            : `Package "${name}" is not installed.`
          outputError('NOT_FOUND', msg)
          process.exit(1)
        }
        console.error(chalk.red(`Package "${name}" is not installed.`))
        if (hint) {
          console.error(chalk.dim(hint))
        }
        process.exit(1)
      }

      const { key: packageKey, displayName, pkg: manifestEntry } = packageLookup
      const { source, agents } = manifestEntry

      if (source.type === 'well-known') {
        const spinner = createSpinner(`Fetching upstream files from ${source.hostname}...`).start()

        try {
          const index = await fetchWellKnownIndex(source.baseUrl)
          const entry = index.skills.find((s) => s.name === source.skillName)

          if (!entry) {
            const message = `Skill "${source.skillName}" no longer exists at ${source.hostname}`
            if (jsonMode) {
              spinner.stop()
              outputError('NOT_FOUND', message)
              process.exit(1)
            }
            spinner.fail(message)
            process.exit(1)
          }

          const fetchResult = await fetchWellKnownSkill(source.baseUrl, entry)
          spinner.text = 'Comparing files...'

          const localFiles = await readLocalFiles(projectRoot, displayName, agents, scope)

          const upstreamMap = new Map<string, string>()
          for (const file of fetchResult.files) {
            upstreamMap.set(file.path, file.content)
          }

          const localMap = new Map<string, string>()
          for (const file of localFiles) {
            localMap.set(file.path, file.content)
          }

          const diffs = diffFiles(upstreamMap, localMap)
          spinner.stop()

          if (jsonMode) {
            const diffResult: DiffResult = {
              name: displayName,
              hunks: diffs.flatMap((d) =>
                d.hunks.map((h) => ({
                  file: d.path,
                  additions: h.lines.filter((l) => l.startsWith('+')).length,
                  deletions: h.lines.filter((l) => l.startsWith('-')).length,
                  content: h.lines.join('\n'),
                }))
              ),
            }
            outputSuccess(diffResult)
            return
          }

          if (diffs.length === 0) {
            console.log(chalk.green(`No differences found for ${displayName}.`))
            return
          }

          console.log(formatDiff(diffs))
        } catch (error) {
          const message = `Failed to generate diff: ${error instanceof Error ? error.message : String(error)}`
          if (jsonMode) {
            spinner.stop()
            outputError('DIFF_FAILED', message)
            process.exit(1)
          }
          spinner.fail(message)
          process.exit(1)
        }

        return
      }

      if (source.type === 'unknown') {
        if (jsonMode) {
          outputError(
            'UNKNOWN_SOURCE',
            `Package "${displayName}" was migrated from v1 and has no known Git source.`
          )
          process.exit(1)
        }
        console.error(
          chalk.red(`Package "${displayName}" was migrated from v1 and has no known Git source.`)
        )
        console.error(
          chalk.dim('Reinstall it using a Git source URL to enable diff:\n') +
            chalk.dim(`  agentver remove ${displayName}\n`) +
            chalk.dim(`  agentver install <git-source>`)
        )
        process.exit(1)
      }

      if (source.type === 'local') {
        const message = `Package "${displayName}" is a local source and has no upstream diff target.`
        if (jsonMode) {
          outputError('LOCAL_SOURCE', message)
          process.exit(1)
        }
        console.error(chalk.red(message))
        process.exit(1)
      }

      const spinner = createSpinner('Fetching upstream files...').start()

      try {
        const lockfileEntry = lockfile.packages[packageKey]
        const lockfileSource = lockfileEntry?.source
        const commitSha =
          lockfileSource?.type === 'git' || lockfileSource?.type === 'platform'
            ? lockfileSource.commit
            : source.commit

        const fetchResult =
          source.type === 'platform'
            ? await fetchPlatformFiles({
                uri: source.uri,
                path: source.path,
                ref: source.ref,
                commit: commitSha,
                expectedIntegrity: lockfileEntry?.integrity,
              })
            : await (() => {
                const cliSource = parseManifestUri(source.uri)
                if (!cliSource) {
                  throw new Error(`Could not parse source URI: ${source.uri}`)
                }

                cliSource.ref = source.ref
                cliSource.commit = source.commit
                const resolved: ResolvedRef = {
                  source: { ...cliSource, path: source.path },
                  commitSha,
                }

                return fetchFiles(resolved, {
                  expectedIntegrity: lockfileEntry?.integrity,
                })
              })()
        spinner.text = 'Comparing files...'

        const localFiles = await readLocalFiles(projectRoot, displayName, agents, scope)

        const upstreamMap = new Map<string, string>()
        for (const file of fetchResult.files) {
          upstreamMap.set(file.path, file.content)
        }

        const localMap = new Map<string, string>()
        for (const file of localFiles) {
          localMap.set(file.path, file.content)
        }

        const diffs = diffFiles(upstreamMap, localMap)
        spinner.stop()

        if (jsonMode) {
          const diffResult: DiffResult = {
            name: displayName,
            hunks: diffs.flatMap((d) =>
              d.hunks.map((h) => ({
                file: d.path,
                additions: h.lines.filter((l) => l.startsWith('+')).length,
                deletions: h.lines.filter((l) => l.startsWith('-')).length,
                content: h.lines.join('\n'),
              }))
            ),
          }
          outputSuccess(diffResult)
          return
        }

        if (diffs.length === 0) {
          console.log(chalk.green(`No differences found for ${displayName}.`))
          return
        }

        console.log(formatDiff(diffs))
      } catch (error) {
        const message = `Failed to generate diff: ${error instanceof Error ? error.message : String(error)}`
        if (jsonMode) {
          outputError('DIFF_FAILED', message)
          process.exit(1)
        }
        spinner.fail(message)
        process.exit(1)
      }
    })
}
