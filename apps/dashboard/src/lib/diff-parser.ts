// ---------------------------------------------------------------------------
// Unified diff parser — converts raw diff text into structured types
// ---------------------------------------------------------------------------

export type DiffLine = {
  type: 'add' | 'delete' | 'context'
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

export type DiffHunk = {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export type DiffFile = {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

export type DiffStat = {
  filesChanged: number
  additions: number
  deletions: number
}

const DIFF_HEADER_REGEX = /^diff --git a\/(.+?) b\/(.+)$/
const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

/**
 * Parse a unified diff string into structured DiffFile objects.
 */
export function parseUnifiedDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = []
  const lines = diffText.split('\n')

  let currentFile: DiffFile | null = null
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // Match file header
    const headerMatch = DIFF_HEADER_REGEX.exec(line)
    if (headerMatch) {
      // Finalise previous file
      if (currentFile) {
        files.push(currentFile)
      }

      const aPath = headerMatch[1]!
      const bPath = headerMatch[2]!
      const status = detectFileStatus(lines, i, aPath, bPath)

      currentFile = {
        path: bPath === '/dev/null' ? aPath : bPath,
        status,
        additions: 0,
        deletions: 0,
        hunks: [],
      }
      currentHunk = null
      continue
    }

    // Match hunk header
    const hunkMatch = HUNK_HEADER_REGEX.exec(line)
    if (hunkMatch && currentFile) {
      const hunkOldStart = Number.parseInt(hunkMatch[1]!, 10)
      const hunkOldLines = Number.parseInt(hunkMatch[2] ?? '1', 10)
      const hunkNewStart = Number.parseInt(hunkMatch[3]!, 10)
      const hunkNewLines = Number.parseInt(hunkMatch[4] ?? '1', 10)

      currentHunk = {
        header: line,
        oldStart: hunkOldStart,
        oldLines: hunkOldLines,
        newStart: hunkNewStart,
        newLines: hunkNewLines,
        lines: [],
      }
      currentFile.hunks.push(currentHunk)

      oldLine = hunkOldStart
      newLine = hunkNewStart
      continue
    }

    // Parse diff content lines
    if (!currentHunk || !currentFile) continue

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'add',
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine,
      })
      currentFile.additions++
      newLine++
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'delete',
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: null,
      })
      currentFile.deletions++
      oldLine++
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      })
      oldLine++
      newLine++
    }
    // Skip lines starting with '\' (e.g. "\ No newline at end of file")
  }

  // Finalise the last file
  if (currentFile) {
    files.push(currentFile)
  }

  return files
}

/**
 * Calculate summary statistics from parsed diff files.
 */
export function calculateDiffStat(files: DiffFile[]): DiffStat {
  let additions = 0
  let deletions = 0

  for (const file of files) {
    additions += file.additions
    deletions += file.deletions
  }

  return {
    filesChanged: files.length,
    additions,
    deletions,
  }
}

/**
 * Detect the status of a file from the diff context lines following the header.
 */
function detectFileStatus(
  lines: string[],
  headerIndex: number,
  aPath: string,
  bPath: string
): DiffFile['status'] {
  // Check the extended header lines between the diff header and the first hunk
  for (let j = headerIndex + 1; j < Math.min(headerIndex + 6, lines.length); j++) {
    const contextLine = lines[j]!

    if (contextLine.startsWith('new file')) return 'added'
    if (contextLine.startsWith('deleted file')) return 'deleted'
    if (contextLine.startsWith('rename from') || contextLine.startsWith('similarity index')) {
      return 'renamed'
    }
    if (contextLine.startsWith('@@') || contextLine.startsWith('diff --git')) break
  }

  if (aPath === '/dev/null') return 'added'
  if (bPath === '/dev/null') return 'deleted'

  return 'modified'
}
