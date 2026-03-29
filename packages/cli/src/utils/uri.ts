const AGENTVER_PROTOCOL = 'agentver://'

export type UriSegments = {
  host: string
  owner: string
  repo: string
}

/**
 * Parse a manifest source URI into host / owner / repo segments.
 *
 * Handles two formats:
 *  - `agentver://org` → `{ host: 'agentver', owner: 'org', repo: 'platform' }`
 *  - `host/org/repo` or `https://host/org/repo` → `{ host, owner, repo }`
 *
 * Returns `null` when the URI cannot be meaningfully parsed.
 */
export function parseUriSegments(uri: string): UriSegments | null {
  if (uri.startsWith(AGENTVER_PROTOCOL)) {
    const withoutProtocol = uri.slice(AGENTVER_PROTOCOL.length)
    const segments = withoutProtocol.split('/').filter((s) => s.trim() !== '')
    if (segments.length === 0) return null
    return { host: 'agentver', owner: segments[0]!, repo: 'platform' }
  }

  const parts = uri.split('/')
  // Strip empty segments and protocol prefixes (e.g. "https:", "http:")
  const meaningful = parts.filter((p) => p !== '' && !p.endsWith(':'))
  if (meaningful.length < 2) return null
  return {
    host: meaningful[0]!,
    owner: meaningful[1]!,
    repo: meaningful[2] ?? 'unknown',
  }
}

/**
 * Extract the org (namespace) from a manifest source URI.
 * Convenience wrapper around `parseUriSegments`.
 */
export function extractOrgFromUri(uri: string): string | null {
  return parseUriSegments(uri)?.owner ?? null
}
