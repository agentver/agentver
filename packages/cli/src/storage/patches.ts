import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PATCHES_DIR = '.agentver/patches'
const CONTEXT_LINES = 3

type FileEntry = { path: string; content: string }

type PatchHunk = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: string[]
}

type FilePatch = {
  filePath: string
  hunks: PatchHunk[]
}

type ApplyResult = {
  applied: boolean
  conflicts: string[]
}

function getPatchPath(projectRoot: string, packageName: string): string {
  return join(projectRoot, PATCHES_DIR, `${packageName}.patch`)
}

export function savePatch(projectRoot: string, packageName: string, patchContent: string): string {
  const patchPath = getPatchPath(projectRoot, packageName)
  const dir = join(projectRoot, PATCHES_DIR)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const tmpPath = `${patchPath}.tmp`
  writeFileSync(tmpPath, patchContent, 'utf-8')
  renameSync(tmpPath, patchPath)
  return patchPath
}

export function removePatch(projectRoot: string, packageName: string): void {
  const patchPath = getPatchPath(projectRoot, packageName)

  if (existsSync(patchPath)) {
    rmSync(patchPath)
  }
}

export function generatePatch(
  baseFiles: FileEntry[],
  localFiles: FileEntry[],
  packageName: string
): string {
  const baseMap = new Map(baseFiles.map((f) => [f.path, f.content]))
  const localMap = new Map(localFiles.map((f) => [f.path, f.content]))

  const allPaths = new Set([...baseMap.keys(), ...localMap.keys()])
  const sortedPaths = [...allPaths].sort()

  const output: string[] = []

  for (const filePath of sortedPaths) {
    const baseContent = baseMap.get(filePath)
    const localContent = localMap.get(filePath)

    if (baseContent === localContent) continue

    const baseLines = baseContent !== undefined ? baseContent.split('\n') : []
    const localLines = localContent !== undefined ? localContent.split('\n') : []

    const prefix = `${packageName}/`
    const aPath = baseContent !== undefined ? `a/${prefix}${filePath}` : '/dev/null'
    const bPath = localContent !== undefined ? `b/${prefix}${filePath}` : '/dev/null'

    const hunks = computeHunks(baseLines, localLines)
    if (hunks.length === 0) continue

    output.push(`--- ${aPath}`)
    output.push(`+++ ${bPath}`)

    for (const hunk of hunks) {
      output.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`)
      output.push(...hunk.lines)
    }
  }

  if (output.length === 0) return ''

  return `${output.join('\n')}\n`
}

export function applyPatch(projectRoot: string, patchContent: string): ApplyResult {
  const filePatches = parsePatch(patchContent)
  const conflicts: string[] = []

  for (const filePatch of filePatches) {
    const success = applyFilePatch(projectRoot, filePatch)
    if (!success) {
      conflicts.push(filePatch.filePath)
    }
  }

  return {
    applied: conflicts.length === 0,
    conflicts,
  }
}

function applyFilePatch(projectRoot: string, filePatch: FilePatch): boolean {
  const fullPath = join(projectRoot, filePatch.filePath)

  const hasOnlyAdditions = filePatch.hunks.every((h) =>
    h.lines.every((l) => l.startsWith('+') || l.startsWith(' '))
  )
  const hasOnlyDeletions = filePatch.hunks.every((h) =>
    h.lines.every((l) => l.startsWith('-') || l.startsWith(' '))
  )

  if (hasOnlyAdditions && !existsSync(fullPath)) {
    const content = filePatch.hunks
      .flatMap((h) => h.lines.filter((l) => l.startsWith('+')).map((l) => l.slice(1)))
      .join('\n')

    const dir = join(fullPath, '..')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const tmpPath = `${fullPath}.tmp`
    writeFileSync(tmpPath, content, 'utf-8')
    renameSync(tmpPath, fullPath)
    return true
  }

  if (hasOnlyDeletions && existsSync(fullPath)) {
    const currentContent = readFileSync(fullPath, 'utf-8')
    const currentLines = currentContent.split('\n')
    const deletionResult = applyHunksToLines(currentLines, filePatch)
    if (!deletionResult.success) {
      return false
    }

    const isEmptyAfterPatch =
      deletionResult.lines.length === 0 || deletionResult.lines.every((l) => l === '')
    if (isEmptyAfterPatch) {
      rmSync(fullPath)
      return true
    }

    const tmpPath = `${fullPath}.tmp`
    writeFileSync(tmpPath, deletionResult.lines.join('\n'), 'utf-8')
    renameSync(tmpPath, fullPath)
    return true
  }

  if (!existsSync(fullPath)) {
    return false
  }

  const currentContent = readFileSync(fullPath, 'utf-8')
  const applyResult = applyHunksToLines(currentContent.split('\n'), filePatch)
  if (!applyResult.success) return false

  const tmpPath = `${fullPath}.tmp`
  writeFileSync(tmpPath, applyResult.lines.join('\n'), 'utf-8')
  renameSync(tmpPath, fullPath)
  return true
}

function applyHunksToLines(
  lines: string[],
  filePatch: FilePatch
): { success: boolean; lines: string[] } {
  const nextLines = [...lines]
  let offset = 0

  for (const hunk of filePatch.hunks) {
    const result = applyHunk(nextLines, hunk, offset)
    if (!result.success) {
      return { success: false, lines }
    }
    offset = result.offset
  }

  return { success: true, lines: nextLines }
}

function applyHunk(
  lines: string[],
  hunk: PatchHunk,
  offset: number
): { success: boolean; offset: number } {
  const oldLines = hunk.lines
    .filter((l) => l.startsWith(' ') || l.startsWith('-'))
    .map((l) => l.slice(1))

  const newLines = hunk.lines
    .filter((l) => l.startsWith(' ') || l.startsWith('+'))
    .map((l) => l.slice(1))

  const targetStart = hunk.oldStart - 1 + offset
  const searchRadius = CONTEXT_LINES
  const searchStart = Math.max(0, targetStart - searchRadius)
  const searchEnd = Math.min(lines.length, targetStart + oldLines.length + searchRadius)

  let matchPos = -1
  for (let i = searchStart; i <= searchEnd - oldLines.length; i++) {
    let matches = true
    for (let j = 0; j < oldLines.length; j++) {
      if (lines[i + j] !== oldLines[j]) {
        matches = false
        break
      }
    }
    if (matches) {
      matchPos = i
      break
    }
  }

  if (matchPos === -1) {
    return { success: false, offset }
  }

  lines.splice(matchPos, oldLines.length, ...newLines)

  return {
    success: true,
    offset: offset + (newLines.length - oldLines.length),
  }
}

function parsePatch(patchContent: string): FilePatch[] {
  const lines = patchContent.split('\n')
  const filePatches: FilePatch[] = []

  let currentFile: FilePatch | null = null
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    if (line.startsWith('--- ')) {
      const nextLine = lines[i + 1]
      if (nextLine?.startsWith('+++ ')) {
        const bPath = nextLine.slice(4)
        const filePath = extractFilePath(bPath)

        if (filePath) {
          currentFile = { filePath, hunks: [] }
          filePatches.push(currentFile)
        }
        i += 2
        continue
      }
    }

    if (line.startsWith('@@ ') && currentFile) {
      const hunkHeader = parseHunkHeader(line)
      if (hunkHeader) {
        const hunk: PatchHunk = { ...hunkHeader, lines: [] }

        i++
        while (i < lines.length) {
          const hunkLine = lines[i]!
          if (
            hunkLine.startsWith('--- ') ||
            hunkLine.startsWith('@@ ') ||
            (hunkLine === '' && i === lines.length - 1)
          ) {
            break
          }
          if (hunkLine.startsWith(' ') || hunkLine.startsWith('+') || hunkLine.startsWith('-')) {
            hunk.lines.push(hunkLine)
          }
          i++
        }

        currentFile.hunks.push(hunk)
        continue
      }
    }

    i++
  }

  return filePatches
}

function extractFilePath(bPath: string): string | null {
  if (bPath === '/dev/null') return null

  if (bPath.startsWith('b/')) {
    const withoutPrefix = bPath.slice(2)
    const slashIdx = withoutPrefix.indexOf('/')
    if (slashIdx !== -1) {
      return withoutPrefix.slice(slashIdx + 1)
    }
    return withoutPrefix
  }

  return bPath
}

function parseHunkHeader(
  line: string
): { oldStart: number; oldCount: number; newStart: number; newCount: number } | null {
  const match = line.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/)
  if (!match) return null

  return {
    oldStart: Number.parseInt(match[1]!, 10),
    oldCount: Number.parseInt(match[2]!, 10),
    newStart: Number.parseInt(match[3]!, 10),
    newCount: Number.parseInt(match[4]!, 10),
  }
}

// --- Unified diff generation ---

type EditOp = {
  type: 'equal' | 'insert' | 'delete'
  oldIdx: number
  newIdx: number
}

function computeHunks(oldLines: string[], newLines: string[]): PatchHunk[] {
  const editOps = myersDiff(oldLines, newLines)

  const changeGroups: Array<{ start: number; end: number }> = []
  let groupStart = -1

  for (let i = 0; i < editOps.length; i++) {
    if (editOps[i]!.type !== 'equal') {
      if (groupStart === -1) groupStart = i
    } else if (groupStart !== -1) {
      changeGroups.push({ start: groupStart, end: i })
      groupStart = -1
    }
  }
  if (groupStart !== -1) {
    changeGroups.push({ start: groupStart, end: editOps.length })
  }

  if (changeGroups.length === 0) return []

  const mergedGroups = mergeCloseGroups(changeGroups, CONTEXT_LINES * 2)
  const hunks: PatchHunk[] = []

  for (const group of mergedGroups) {
    const firstChange = editOps[group.start]!
    const lastChange = editOps[group.end - 1]!

    const ctxOldStart = Math.max(0, firstChange.oldIdx - CONTEXT_LINES)
    const ctxNewStart = Math.max(0, firstChange.newIdx - CONTEXT_LINES)

    const lastOldIdx = lastChange.type === 'insert' ? lastChange.oldIdx : lastChange.oldIdx + 1
    const lastNewIdx = lastChange.type === 'delete' ? lastChange.newIdx : lastChange.newIdx + 1

    const ctxOldEnd = Math.min(oldLines.length, lastOldIdx + CONTEXT_LINES)
    const ctxNewEnd = Math.min(newLines.length, lastNewIdx + CONTEXT_LINES)

    const hunkLines: string[] = []
    let oldCount = 0
    let newCount = 0

    let oi = ctxOldStart
    let ni = ctxNewStart
    while (oi < firstChange.oldIdx && ni < firstChange.newIdx) {
      hunkLines.push(` ${oldLines[oi]!}`)
      oldCount++
      newCount++
      oi++
      ni++
    }

    for (let i = group.start; i < group.end; i++) {
      const op = editOps[i]!
      if (op.type === 'equal') {
        hunkLines.push(` ${oldLines[op.oldIdx]!}`)
        oldCount++
        newCount++
      } else if (op.type === 'delete') {
        hunkLines.push(`-${oldLines[op.oldIdx]!}`)
        oldCount++
      } else {
        hunkLines.push(`+${newLines[op.newIdx]!}`)
        newCount++
      }
    }

    const lastOp = editOps[group.end - 1]!
    let trailOi = lastOp.type === 'delete' ? lastOp.oldIdx + 1 : lastOp.oldIdx
    let trailNi = lastOp.type === 'insert' ? lastOp.newIdx + 1 : lastOp.newIdx
    if (lastOp.type === 'equal') {
      trailOi = lastOp.oldIdx + 1
      trailNi = lastOp.newIdx + 1
    }

    while (trailOi < ctxOldEnd && trailNi < ctxNewEnd) {
      hunkLines.push(` ${oldLines[trailOi]!}`)
      oldCount++
      newCount++
      trailOi++
      trailNi++
    }

    hunks.push({
      oldStart: ctxOldStart + 1,
      oldCount,
      newStart: ctxNewStart + 1,
      newCount,
      lines: hunkLines,
    })
  }

  return hunks
}

function mergeCloseGroups(
  groups: Array<{ start: number; end: number }>,
  threshold: number
): Array<{ start: number; end: number }> {
  if (groups.length === 0) return []

  const merged = [{ ...groups[0]! }]

  for (let i = 1; i < groups.length; i++) {
    const prev = merged[merged.length - 1]!
    const current = groups[i]!
    const gap = current.start - prev.end

    if (gap <= threshold) {
      prev.end = current.end
    } else {
      merged.push({ ...current })
    }
  }

  return merged
}

function myersDiff(oldLines: string[], newLines: string[]): EditOp[] {
  const oldLen = oldLines.length
  const newLen = newLines.length

  if (oldLen === 0 && newLen === 0) return []

  if (oldLen === 0) {
    return newLines.map((_, i) => ({
      type: 'insert' as const,
      oldIdx: 0,
      newIdx: i,
    }))
  }

  if (newLen === 0) {
    return oldLines.map((_, i) => ({
      type: 'delete' as const,
      oldIdx: i,
      newIdx: 0,
    }))
  }

  const max = oldLen + newLen
  const vSize = 2 * max + 1
  const v = new Int32Array(vSize).fill(0)
  const trace: Int32Array[] = []

  const idx = (k: number) => k + max

  v[idx(1)] = 0

  for (let d = 0; d <= max; d++) {
    trace.push(new Int32Array(v))

    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && v[idx(k - 1)]! < v[idx(k + 1)]!)) {
        x = v[idx(k + 1)]!
      } else {
        x = v[idx(k - 1)]! + 1
      }

      let y = x - k

      while (x < oldLen && y < newLen && oldLines[x] === newLines[y]) {
        x++
        y++
      }

      v[idx(k)] = x

      if (x >= oldLen && y >= newLen) {
        return backtrackMyers(trace, oldLines, newLines, d, max)
      }
    }
  }

  return []
}

function backtrackMyers(
  trace: Int32Array[],
  oldLines: string[],
  newLines: string[],
  finalD: number,
  max: number
): EditOp[] {
  const idx = (k: number) => k + max
  let x = oldLines.length
  let y = newLines.length
  const edits: EditOp[] = []

  for (let d = finalD; d > 0; d--) {
    const prev = trace[d - 1]!
    const k = x - y

    let prevK: number
    if (k === -d || (k !== d && prev[idx(k - 1)]! < prev[idx(k + 1)]!)) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }

    const prevX = prev[idx(prevK)]!
    const prevY = prevX - prevK

    while (x > prevX && y > prevY) {
      x--
      y--
      edits.unshift({ type: 'equal', oldIdx: x, newIdx: y })
    }

    if (x > prevX) {
      x--
      edits.unshift({ type: 'delete', oldIdx: x, newIdx: y })
    } else if (y > prevY) {
      y--
      edits.unshift({ type: 'insert', oldIdx: x, newIdx: y })
    }
  }

  while (x > 0 && y > 0) {
    x--
    y--
    edits.unshift({ type: 'equal', oldIdx: x, newIdx: y })
  }

  return edits
}
