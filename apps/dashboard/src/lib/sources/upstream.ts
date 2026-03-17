import { createLogger } from '@agentver/shared'

const logger = createLogger('upstream-sync')

type GitHubSourceParts = {
  owner: string
  repo: string
  path: string
}

type UpstreamMeta = {
  sha: string
  size: number
}

type UpstreamCheck = {
  changed: boolean
  currentSha: string
}

/**
 * Parse a GitHub source URI like `github://owner/repo/path/to/file`.
 */
export function parseGitHubSourceUri(uri: string): GitHubSourceParts {
  const stripped = uri.replace('github://', '')
  const parts = stripped.split('/')
  const owner = parts[0]
  const repo = parts[1]
  const path = parts.slice(2).join('/')

  if (!owner || !repo || !path) {
    throw new Error(`Invalid GitHub source URI: ${uri}`)
  }

  return { owner, repo, path }
}

/**
 * Fetch file metadata (blob SHA, size) from GitHub Contents API.
 */
export async function fetchGitHubUpstreamMeta(
  accessToken: string,
  owner: string,
  repo: string,
  path: string
): Promise<UpstreamMeta> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  )

  if (!response.ok) {
    throw new Error(`GitHub API error fetching file metadata: ${response.status}`)
  }

  const data = (await response.json()) as { sha: string; size: number }
  return { sha: data.sha, size: data.size }
}

/**
 * Fetch raw file content from GitHub.
 */
export async function fetchGitHubUpstreamContent(
  accessToken: string,
  owner: string,
  repo: string,
  path: string
): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3.raw',
      },
    }
  )

  if (!response.ok) {
    throw new Error(`GitHub API error fetching file content: ${response.status}`)
  }

  return response.text()
}

/**
 * Check whether upstream content has changed relative to the stored SHA.
 * If sourceCommitSha is null (first check), initialises the SHA without
 * marking as changed.
 */
export async function checkGitHubUpstream(
  accessToken: string,
  sourceUri: string,
  storedSha: string | null
): Promise<UpstreamCheck> {
  const { owner, repo, path } = parseGitHubSourceUri(sourceUri)
  const meta = await fetchGitHubUpstreamMeta(accessToken, owner, repo, path)

  if (storedSha === null) {
    // First time — initialise without flagging as changed
    logger.info('Initialising upstream SHA', { sourceUri, sha: meta.sha })
    return { changed: false, currentSha: meta.sha }
  }

  const changed = meta.sha !== storedSha
  if (changed) {
    logger.info('Upstream change detected', { sourceUri, storedSha, currentSha: meta.sha })
  }

  return { changed, currentSha: meta.sha }
}

/**
 * Bump a semver patch version: "1.2.3" → "1.2.4".
 * Falls back to "0.0.1" if the input is invalid.
 */
export function bumpPatchVersion(currentVersion: string): string {
  const match = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match?.[1] || !match[2] || !match[3]) return '0.0.1'
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}
