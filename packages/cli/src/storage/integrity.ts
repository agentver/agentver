import { createHash } from 'node:crypto'

export function computeSha256FromBuffer(content: Buffer | string): string {
  const hash = createHash('sha256').update(content).digest('base64')
  return `sha256-${hash}`
}

export function computeSha256FromFiles(files: Array<{ path: string; content: string }>): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const combined = sorted.map((f) => `${f.path}\0${f.content}`).join('\0')
  return computeSha256FromBuffer(combined)
}

export function deriveCommitFromIntegrity(integrity: string): string {
  return createHash('sha1').update(integrity).digest('hex')
}
