import { AgentverError } from '@agentver/shared'
import { z } from 'zod'
import type { WellKnownFetchResult, WellKnownIndex, WellKnownIndexEntry } from './types.js'

const EXCLUDED_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org'])

const INDEX_TIMEOUT_MS = 10_000
const FILE_TIMEOUT_MS = 5_000

const wellKnownIndexSchema = z.object({
  skills: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
        description: z.string().min(1).max(1024),
        files: z.array(z.string().min(1)).min(1),
      })
    )
    .min(1),
})

/**
 * Determines whether the given source string looks like a well-known URL
 * (i.e. a bare domain or domain/skill-name) rather than a git URL or short name.
 */
export function looksLikeWellKnownUrl(source: string): boolean {
  const cleaned = source.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const segments = cleaned.split('/').filter(Boolean)

  if (segments.length === 0 || segments.length > 2) {
    return false
  }

  const host = segments[0]!

  // Must contain a dot (it's a domain)
  if (!host.includes('.')) {
    return false
  }

  // Exclude known git hosts
  if (EXCLUDED_HOSTS.has(host.toLowerCase())) {
    return false
  }

  // Must NOT end with .git
  if (cleaned.endsWith('.git')) {
    return false
  }

  return true
}

/**
 * Parses a well-known source string into a baseUrl and optional skill name.
 *
 * - `example.com` -> `{ baseUrl: 'https://example.com' }`
 * - `example.com/my-skill` -> `{ baseUrl: 'https://example.com', skillName: 'my-skill' }`
 * - `https://example.com/my-skill` -> same
 */
export function parseWellKnownSource(source: string): {
  baseUrl: string
  skillName?: string
} {
  const cleaned = source.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const segments = cleaned.split('/').filter(Boolean)

  const host = segments[0]!
  const baseUrl = `https://${host}`

  if (segments.length >= 2) {
    return { baseUrl, skillName: segments[1] }
  }

  return { baseUrl }
}

/**
 * Fetches and validates the well-known skills index from a domain.
 * Always uses HTTPS (auto-upgrades http).
 */
export async function fetchWellKnownIndex(baseUrl: string): Promise<WellKnownIndex> {
  const httpsUrl = baseUrl.replace(/^http:\/\//, 'https://')
  const indexUrl = `${httpsUrl}/.well-known/skills/index.json`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), INDEX_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(indexUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timeoutId)
  } catch (error) {
    clearTimeout(timeoutId)
    throw new AgentverError(
      'INTERNAL_ERROR',
      `Failed to fetch well-known index from ${indexUrl}: ${String(error)}`
    )
  }

  if (!response.ok) {
    throw new AgentverError(
      'NOT_FOUND',
      `No well-known skills index found at ${indexUrl} (HTTP ${String(response.status)})`
    )
  }

  const raw: unknown = await response.json()
  const result = wellKnownIndexSchema.safeParse(raw)

  if (!result.success) {
    throw new AgentverError(
      'VALIDATION_ERROR',
      `Invalid well-known skills index at ${indexUrl}: ${result.error.message}`
    )
  }

  return result.data
}

/**
 * Validates a file path for path traversal attacks.
 * Rejects paths containing `..`, leading `/` or `\`.
 */
function validateFilePath(filePath: string): boolean {
  if (filePath.includes('..')) return false
  if (filePath.startsWith('/')) return false
  if (filePath.startsWith('\\')) return false
  if (filePath.includes('\\')) return false
  return true
}

/**
 * Fetches all files for a single well-known skill entry.
 */
export async function fetchWellKnownSkill(
  baseUrl: string,
  entry: WellKnownIndexEntry
): Promise<WellKnownFetchResult> {
  const httpsUrl = baseUrl.replace(/^http:\/\//, 'https://')
  const hostname = new URL(httpsUrl).hostname
  const files: Array<{ path: string; content: string; size: number }> = []

  for (const filePath of entry.files) {
    if (!validateFilePath(filePath)) {
      throw new AgentverError(
        'VALIDATION_ERROR',
        `Unsafe file path in well-known skill "${entry.name}": ${filePath}`
      )
    }

    const fileUrl = `${httpsUrl}/.well-known/skills/${entry.name}/${filePath}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(fileUrl, { signal: controller.signal })
      clearTimeout(timeoutId)
    } catch (error) {
      clearTimeout(timeoutId)
      throw new AgentverError(
        'INTERNAL_ERROR',
        `Failed to fetch file ${filePath} from ${fileUrl}: ${String(error)}`
      )
    }

    if (!response.ok) {
      throw new AgentverError(
        'NOT_FOUND',
        `File not found: ${fileUrl} (HTTP ${String(response.status)})`
      )
    }

    const content = await response.text()
    files.push({
      path: filePath,
      content,
      size: Buffer.byteLength(content, 'utf-8'),
    })
  }

  return {
    name: entry.name,
    description: entry.description,
    files,
    sourceUrl: `${httpsUrl}/.well-known/skills/${entry.name}`,
    hostname,
  }
}
