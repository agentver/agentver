const AGENTVER_PROTOCOL = 'agentver://'

/**
 * Extract the org (namespace) from a manifest source URI.
 *
 * Handles two formats:
 *  - `agentver://org` (or `agentver://org/path`) — returns the first path segment after the protocol
 *  - `host/org/repo` (e.g. `github.com/myorg/myrepo`) — returns the second segment
 *
 * Returns `null` when the org cannot be determined.
 */
export function extractOrgFromUri(uri: string): string | null {
  if (uri.startsWith(AGENTVER_PROTOCOL)) {
    const withoutProtocol = uri.slice(AGENTVER_PROTOCOL.length)
    const segments = withoutProtocol.split('/').filter(Boolean)
    return segments[0] ?? null
  }

  const parts = uri.split('/')
  // For host/org/repo or https://host/org/repo, find the first non-empty
  // segment that isn't a protocol prefix (e.g. "https:", "http:", "")
  const meaningful = parts.filter((p) => p !== '' && !p.endsWith(':'))
  // meaningful[0] = host, meaningful[1] = org
  return meaningful[1] ?? null
}
