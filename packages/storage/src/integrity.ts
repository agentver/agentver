import { createHash } from 'node:crypto'
import { IntegrityError } from './errors'

/** Computes a SHA256 integrity hash from a set of files. */
export function computeIntegrity(files: Array<{ path: string; content: string }>): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const combined = sorted.map((f) => `${f.path}\0${f.content}`).join('\0')
  return computeIntegrityFromBuffer(combined)
}

/** Computes SHA256 from raw buffer/string content. */
export function computeIntegrityFromBuffer(content: Buffer | string): string {
  const hash = createHash('sha256').update(content).digest('base64')
  return `sha256-${hash}`
}

/** Derives a git-style commit hash from an integrity string. */
export function deriveCommitFromIntegrity(integrity: string): string {
  return createHash('sha1').update(integrity).digest('hex')
}

/** Verifies file integrity against an expected hash. Throws IntegrityError on mismatch. */
export function verifyIntegrity(
  files: Array<{ path: string; content: string }>,
  expected: string,
  packageName: string
): void {
  if (!expected) {
    return
  }

  const actual = computeIntegrity(files)
  if (actual !== expected) {
    throw new IntegrityError(packageName, expected, actual)
  }
}
