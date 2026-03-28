import { createHash } from 'node:crypto'

/**
 * Compute a SHA-256 integrity hash from a list of files.
 *
 * Files are sorted by path, concatenated with null-byte separators
 * (path\0content between entries), and hashed as base64. This matches the
 * lockfile integrity format used across CLI, GitHub Action, and MCP server.
 */
export function computeIntegrityHash(
  files: Array<{ path: string; content: string }>
): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const combined = sorted.map((f) => `${f.path}\0${f.content}`).join('\0')
  const hash = createHash('sha256').update(combined).digest('base64')
  return `sha256-${hash}`
}
