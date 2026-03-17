'use client'

import { cn } from '@agentver/ui-utils'
import { useMemo } from 'react'

type DiffLine = {
  type: 'added' | 'removed' | 'unchanged'
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

function computeDiff(original: string, proposed: string): DiffLine[] {
  const originalLines = original.split('\n')
  const proposedLines = proposed.split('\n')
  const lines: DiffLine[] = []

  // Simple longest common subsequence (LCS) based diff
  const m = originalLines.length
  const n = proposedLines.length

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[])

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (originalLines[i - 1] === proposedLines[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
      }
    }
  }

  // Backtrack to produce the diff
  let i = m
  let j = n
  const result: DiffLine[] = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalLines[i - 1] === proposedLines[j - 1]) {
      result.push({
        type: 'unchanged',
        content: originalLines[i - 1]!,
        oldLineNumber: i,
        newLineNumber: j,
      })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.push({
        type: 'added',
        content: proposedLines[j - 1]!,
        oldLineNumber: null,
        newLineNumber: j,
      })
      j--
    } else {
      result.push({
        type: 'removed',
        content: originalLines[i - 1]!,
        oldLineNumber: i,
        newLineNumber: null,
      })
      i--
    }
  }

  result.reverse()

  return result.length > 0 ? result : lines
}

type DiffViewProps = {
  original: string
  proposed: string
}

export function DiffView({ original, proposed }: DiffViewProps) {
  const diffLines = useMemo(() => computeDiff(original, proposed), [original, proposed])

  const hasChanges = diffLines.some((line) => line.type !== 'unchanged')

  if (!hasChanges) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border border-dashed py-10 text-center">
        <p className="text-muted-foreground text-sm">No changes detected</p>
        <p className="mt-1 text-muted-foreground text-xs">
          The proposed content is identical to the current version.
        </p>
      </div>
    )
  }

  const addedCount = diffLines.filter((l) => l.type === 'added').length
  const removedCount = diffLines.filter((l) => l.type === 'removed').length

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-muted-foreground text-xs">
        <span className="text-emerald-700">+{addedCount} added</span>
        <span className="text-red-700">-{removedCount} removed</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse font-mono text-xs">
          <tbody>
            {diffLines.map((line, index) => (
              <tr
                key={index}
                className={cn(
                  line.type === 'added' && 'bg-emerald-50 dark:bg-emerald-950/30',
                  line.type === 'removed' && 'bg-red-50 dark:bg-red-950/30'
                )}
              >
                <td className="w-10 select-none border-border border-r px-2 py-0.5 text-right text-muted-foreground/50">
                  {line.oldLineNumber ?? ''}
                </td>
                <td className="w-10 select-none border-border border-r px-2 py-0.5 text-right text-muted-foreground/50">
                  {line.newLineNumber ?? ''}
                </td>
                <td className="w-6 select-none px-1 py-0.5 text-center">
                  {line.type === 'added' && <span className="font-bold text-emerald-700">+</span>}
                  {line.type === 'removed' && <span className="font-bold text-red-700">-</span>}
                </td>
                <td className="whitespace-pre-wrap break-all px-2 py-0.5">
                  {line.content || '\u00A0'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
