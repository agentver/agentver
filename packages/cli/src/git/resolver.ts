import { AgentverError, createLogger } from '@agentver/shared'
import { buildRepoUrl, execGit } from './fetcher.js'
import type { GitHost, GitSource, ResolvedRef } from './types.js'

const logger = createLogger('git:resolver')

const KNOWN_HOSTS: GitHost[] = ['github.com', 'gitlab.com', 'bitbucket.org']
const RESOLVE_TIMEOUT_MS = 15_000

export function parseGitSource(source: string): GitSource {
  let cleaned = source.trim()

  if (cleaned.startsWith('https://')) {
    cleaned = cleaned.slice(8)
  }

  if (cleaned.startsWith('http://')) {
    cleaned = cleaned.slice(7)
  }

  // Extract commit SHA if specified with #
  let commit: string | undefined
  const hashIndex = cleaned.indexOf('#')
  if (hashIndex !== -1) {
    commit = cleaned.slice(hashIndex + 1)
    cleaned = cleaned.slice(0, hashIndex)
    if (!commit) {
      throw new AgentverError('VALIDATION_ERROR', 'Empty commit SHA after # separator')
    }
  }

  // Extract ref if specified with @
  let ref = 'HEAD'
  const atIndex = cleaned.indexOf('@')
  if (atIndex !== -1) {
    ref = cleaned.slice(atIndex + 1)
    cleaned = cleaned.slice(0, atIndex)
    if (!ref) {
      throw new AgentverError('VALIDATION_ERROR', 'Empty ref after @ separator')
    }
  }

  // Cannot have both # and @
  if (commit && ref !== 'HEAD') {
    throw new AgentverError(
      'VALIDATION_ERROR',
      'Cannot specify both a commit SHA (#) and a ref (@) — use one or the other'
    )
  }

  const segments = cleaned.split('/').filter(Boolean)

  if (segments.length < 3) {
    throw new AgentverError(
      'VALIDATION_ERROR',
      `Invalid git source "${source}" — expected format: host/owner/repo[/path][@ref|#commit]`
    )
  }

  const hostRaw = segments[0]!
  const owner = segments[1]!
  const repo = segments[2]!
  const pathParts = segments.slice(3)
  const host: GitHost = KNOWN_HOSTS.includes(hostRaw as GitHost) ? (hostRaw as GitHost) : 'generic'

  return {
    host,
    owner,
    repo,
    path: pathParts.join('/'),
    ref: commit ? 'HEAD' : ref,
    commit,
  }
}

export async function resolveRef(source: GitSource): Promise<ResolvedRef> {
  if (source.commit) {
    return { source, commitSha: source.commit }
  }

  logger.debug(`Resolving ref "${source.ref}" for ${source.host}/${source.owner}/${source.repo}`)

  if (source.host === 'github.com') {
    return resolveGitHubRef(source)
  }

  if (source.host === 'gitlab.com') {
    return resolveGitLabRef(source)
  }

  return resolveViaGitLsRemote(source)
}

async function resolveGitHubRef(source: GitSource): Promise<ResolvedRef> {
  const url = `https://api.github.com/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(source.ref)}`

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'agentver-cli',
  }

  const token = process.env.GITHUB_TOKEN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS)

  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    clearTimeout(timeoutId)

    if (response.status === 403) {
      const remaining = response.headers.get('X-RateLimit-Remaining')
      if (remaining === '0') {
        const resetEpoch = response.headers.get('X-RateLimit-Reset')
        const resetAt = resetEpoch ? new Date(Number(resetEpoch) * 1000).toISOString() : 'unknown'
        throw new AgentverError(
          'RATE_LIMITED',
          `GitHub API rate limit exceeded. Resets at ${resetAt}. Set GITHUB_TOKEN to increase your limit.`
        )
      }
    }

    if (response.status === 404 || response.status === 422) {
      throw new AgentverError(
        'NOT_FOUND',
        `Could not resolve ref "${source.ref}" for ${source.owner}/${source.repo} on GitHub`
      )
    }

    if (!response.ok) {
      throw new AgentverError(
        'INTERNAL_ERROR',
        `GitHub API returned ${response.status} whilst resolving ref "${source.ref}"`
      )
    }

    const data = (await response.json()) as { sha: string }
    return { source, commitSha: data.sha }
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof AgentverError) throw error

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AgentverError(
        'INTERNAL_ERROR',
        `Timed out resolving ref "${source.ref}" from GitHub API`
      )
    }

    logger.warn(`GitHub API failed, falling back to git ls-remote: ${String(error)}`)
    return resolveViaGitLsRemote(source)
  }
}

async function resolveGitLabRef(source: GitSource): Promise<ResolvedRef> {
  const projectId = encodeURIComponent(`${source.owner}/${source.repo}`)
  const url = `https://gitlab.com/api/v4/projects/${projectId}/repository/commits/${encodeURIComponent(source.ref)}`

  const headers: Record<string, string> = {
    'User-Agent': 'agentver-cli',
  }

  const token = process.env.GITLAB_TOKEN
  if (token) {
    headers['PRIVATE-TOKEN'] = token
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS)

  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    clearTimeout(timeoutId)

    if (response.status === 404) {
      throw new AgentverError(
        'NOT_FOUND',
        `Could not resolve ref "${source.ref}" for ${source.owner}/${source.repo} on GitLab`
      )
    }

    if (!response.ok) {
      throw new AgentverError(
        'INTERNAL_ERROR',
        `GitLab API returned ${response.status} whilst resolving ref "${source.ref}"`
      )
    }

    const data = (await response.json()) as { id: string }
    return { source, commitSha: data.id }
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof AgentverError) throw error

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AgentverError(
        'INTERNAL_ERROR',
        `Timed out resolving ref "${source.ref}" from GitLab API`
      )
    }

    logger.warn(`GitLab API failed, falling back to git ls-remote: ${String(error)}`)
    return resolveViaGitLsRemote(source)
  }
}

async function resolveViaGitLsRemote(source: GitSource): Promise<ResolvedRef> {
  const repoUrl = buildRepoUrl(source)

  try {
    const output = await execGit(['ls-remote', repoUrl, source.ref])
    const lines = output.trim().split('\n')

    for (const line of lines) {
      const [sha, _refName] = line.split('\t')
      if (sha && sha.length >= 40) {
        return { source, commitSha: sha }
      }
    }

    // If ref is HEAD and we got nothing, try without ref argument
    if (source.ref === 'HEAD') {
      const headOutput = await execGit(['ls-remote', repoUrl, 'HEAD'])
      const headLine = headOutput.trim().split('\n')[0]
      if (headLine) {
        const [sha] = headLine.split('\t')
        if (sha && sha.length >= 40) {
          return { source, commitSha: sha }
        }
      }
    }

    throw new AgentverError(
      'NOT_FOUND',
      `Could not resolve ref "${source.ref}" for ${source.owner}/${source.repo} via git ls-remote`
    )
  } catch (error) {
    if (error instanceof AgentverError) throw error

    throw new AgentverError(
      'NOT_FOUND',
      `Failed to resolve ref "${source.ref}" for ${source.owner}/${source.repo}: ${String(error)}`
    )
  }
}
