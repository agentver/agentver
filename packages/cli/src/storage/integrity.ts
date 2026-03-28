import { createHash } from 'node:crypto'

export function computeSha256FromBuffer(content: Buffer | string): string {
  const hash = createHash('sha256').update(content).digest('base64')
  return `sha256-${hash}`
}

function concatenateFiles(files: Array<{ path: string; content: string }>): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  return sorted.map((f) => `${f.path}\0${f.content}`).join('\0')
}

export function computeSha256FromFiles(files: Array<{ path: string; content: string }>): string {
  return computeSha256FromBuffer(concatenateFiles(files))
}

export function computeContentHash(files: Array<{ path: string; content: string }>): string {
  return createHash('sha256').update(concatenateFiles(files)).digest('hex').slice(0, 40)
}
