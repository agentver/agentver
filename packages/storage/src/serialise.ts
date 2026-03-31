/**
 * Deterministic JSON serialiser for merge-friendly Git output.
 *
 * - Deep-sorts all object keys alphabetically
 * - Sorts arrays of strings alphabetically
 * - Preserves order of arrays containing non-string elements
 * - 2-space indentation with trailing newline
 */

function sortDeep(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    const allStrings = value.length > 0 && value.every((item) => typeof item === 'string')

    if (allStrings) {
      return [...(value as string[])].sort()
    }

    return value.map(sortDeep)
  }

  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    const keys = Object.keys(value as Record<string, unknown>).sort()

    for (const key of keys) {
      sorted[key] = sortDeep((value as Record<string, unknown>)[key])
    }

    return sorted
  }

  return value
}

export function serialiseDeterministic(data: unknown): string {
  const sorted = sortDeep(data)
  return `${JSON.stringify(sorted, null, 2)}\n`
}
