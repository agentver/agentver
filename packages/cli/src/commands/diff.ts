import type { DiffResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { readFilesFromDirectory } from '../git/fetcher.js'
import { fetchFiles } from '../git/index.js'
import type { GitSource as CliGitSource, ResolvedRef } from '../git/types.js'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output'
import { resolveReadPath } from '../storage/canonical.js'
import { readLockfile } from '../storage/lockfile.js'
import { readManifest } from '../storage/manifest.js'

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
    .action(async (name: string) => {
      const jsonMode = isJSONMode()
      const projectRoot = process.cwd()
      const manifest = readManifest(projectRoot)
      const lockfile = readLockfile(projectRoot)

      const manifestEntry = manifest.packages[name]
      if (!manifestEntry) {
        if (jsonMode) {
          outputError('NOT_INSTALLED', `Package "${name}" is not installed.`)
          process.exit(1)
        }
        console.error(chalk.red(`Package "${name}" is not installed.`))
        process.exit(1)
      }

      const { source, agents } = manifestEntry

      if (source.type === 'well-known') {
        if (jsonMode) {
          outputError('WELL_KNOWN_UNSUPPORTED', `Diff is not yet supported for well-known sources.`)
          process.exit(1)
        }
        console.error(
          chalk.red(
            `Package "${name}" was installed from a well-known source (${source.hostname}).`
          )
        )
        console.error(chalk.dim('Diff is not yet supported for well-known sources.'))
        process.exit(1)
      }

      if (source.uri === 'unknown') {
        if (jsonMode) {
          outputError(
            'UNKNOWN_SOURCE',
            `Package "${name}" was migrated from v1 and has no known Git source.`
          )
          process.exit(1)
        }
        console.error(
          chalk.red(`Package "${name}" was migrated from v1 and has no known Git source.`)
        )
        console.error(
          chalk.dim('Reinstall it using a Git source URL to enable diff:\n') +
            chalk.dim(`  agentver remove ${name}\n`) +
            chalk.dim(`  agentver install <git-source>`)
        )
        process.exit(1)
      }

      const spinner = createSpinner('Fetching upstream files...').start()

      try {
        const cliSource = parseManifestUri(source.uri)
        if (!cliSource) {
          const message = `Could not parse source URI: ${source.uri}`
          if (jsonMode) {
            outputError('INVALID_SOURCE_URI', message)
            process.exit(1)
          }
          spinner.fail(message)
          process.exit(1)
        }

        cliSource.ref = source.ref
        cliSource.commit = source.commit
        const lockfileEntry = lockfile.packages[name]
        const lockfileSource = lockfileEntry?.source
        const commitSha =
          (lockfileSource?.type === 'git' ? lockfileSource.commit : undefined) ?? source.commit

        const resolved: ResolvedRef = {
          source: { ...cliSource, path: source.path },
          commitSha,
        }

        const fetchResult = await fetchFiles(resolved)
        spinner.text = 'Comparing files...'

        const localFiles = await readLocalFiles(projectRoot, name, agents)

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
            name,
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
          console.log(chalk.green('No differences found.'))
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
