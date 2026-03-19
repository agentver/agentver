import type { DetectedFileType } from '@agentver/agent-definitions'
import { createLogger } from '@agentver/shared'

const logger = createLogger('github-import')

type GitHubRepo = {
  owner: string
  name: string
  fullName: string
  defaultBranch: string
}

type GitHubRepoResponse = {
  owner: { login: string }
  name: string
  full_name: string
  default_branch: string
}

type GitHubContentResponse = {
  download_url: string
  path: string
  name: string
  type: string
}

type ScannedGitHubFile = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  downloadUrl: string
}

export async function listUserRepos(accessToken: string): Promise<GitHubRepo[]> {
  const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
    headers: githubHeaders(accessToken),
  })

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`)
  }

  const repos = (await response.json()) as GitHubRepoResponse[]
  return repos.map((repo) => ({
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
  }))
}

function githubHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

export type GitHubApiError = {
  status: number
  rateLimited: boolean
  message: string
}

export function isGitHubApiError(error: unknown): error is GitHubApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'rateLimited' in error &&
    'message' in error
  )
}

export async function scanRepoForSkills(
  owner: string,
  repo: string,
  token?: string | null
): Promise<ScannedGitHubFile[]> {
  const skillPaths = [
    'skills',
    '.claude/skills',
    '.cursor/skills',
    '.agents/skills',
    '.github/skills',
    '.windsurf/skills',
    '.gemini/skills',
    '.roo/skills',
    '.goose/skills',
    '.junie/skills',
    '.aider/skills',
    '.opencode/skills',
  ]

  type ConfigFileEntry = {
    path: string
    agentId: string
  }

  const configFiles: ConfigFileEntry[] = [
    { path: 'CLAUDE.md', agentId: 'claude-code' },
    { path: 'AGENTS.md', agentId: 'codex' },
    { path: 'GEMINI.md', agentId: 'gemini' },
    { path: '.cursorrules', agentId: 'cursor' },
    { path: '.windsurfrules', agentId: 'windsurf' },
    { path: '.github/copilot-instructions.md', agentId: 'copilot' },
    { path: '.junie/guidelines.md', agentId: 'junie' },
    { path: '.goose/config.yaml', agentId: 'goose' },
    { path: '.aider.conf.yml', agentId: 'aider' },
  ]

  const foundFiles: ScannedGitHubFile[] = []
  const headers = githubHeaders(token)

  // Verify the repo is accessible before scanning individual paths.
  // This lets us surface a clear error for private/missing repos early.
  const repoCheckResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers,
  })

  if (!repoCheckResponse.ok) {
    const rateLimitRemaining = repoCheckResponse.headers.get('X-RateLimit-Remaining')
    const isRateLimited =
      repoCheckResponse.status === 429 ||
      (repoCheckResponse.status === 403 && rateLimitRemaining === '0')

    const error: GitHubApiError = {
      status: repoCheckResponse.status,
      rateLimited: isRateLimited,
      message: `GitHub API error: ${repoCheckResponse.status}`,
    }
    throw error
  }

  for (const configEntry of configFiles) {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${configEntry.path}`,
        { headers }
      )

      if (response.ok) {
        const data = (await response.json()) as GitHubContentResponse

        foundFiles.push({
          path: configEntry.path,
          name: configEntry.path,
          type: 'config',
          detectedType: 'AGENT_CONFIG',
          agentId: configEntry.agentId,
          downloadUrl: data.download_url,
        })
      }
    } catch (error) {
      if (isGitHubApiError(error)) throw error
      logger.error(`Failed to check config file ${configEntry.path}`, { error })
    }
  }

  // Also scan .roo/rules directory for rule files
  try {
    const rooRulesResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/.roo/rules`,
      { headers }
    )

    if (rooRulesResponse.ok) {
      const entries = (await rooRulesResponse.json()) as GitHubContentResponse[]
      for (const entry of entries) {
        if (entry.name.endsWith('.md')) {
          foundFiles.push({
            path: entry.path,
            name: entry.name,
            type: 'config',
            detectedType: 'AGENT_CONFIG',
            agentId: 'roo-code',
            downloadUrl: entry.download_url,
          })
        }
      }
    }
  } catch (error) {
    if (isGitHubApiError(error)) throw error
    logger.error('Failed to scan .roo/rules directory', { error })
  }

  const skillPathAgentMap: Record<string, string> = {
    skills: 'multi-agent',
    '.claude': 'claude-code',
    '.cursor': 'cursor',
    '.agents': 'codex',
    '.github': 'copilot',
    '.windsurf': 'windsurf',
    '.gemini': 'gemini',
    '.roo': 'roo-code',
    '.goose': 'goose',
    '.junie': 'junie',
    '.aider': 'aider',
    '.opencode': 'opencode',
  }

  for (const skillPath of skillPaths) {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${skillPath}`,
        { headers }
      )

      if (response.ok) {
        const entries = (await response.json()) as GitHubContentResponse[]
        const prefix = skillPath.split('/')[0] ?? ''
        const agentId = skillPathAgentMap[prefix] ?? 'copilot'

        for (const entry of entries) {
          if (entry.type === 'dir') {
            foundFiles.push({
              path: entry.path,
              name: entry.name,
              type: 'skill',
              detectedType: 'SKILL',
              agentId,
              downloadUrl: '',
            })
          }
        }
      }
    } catch (error) {
      if (isGitHubApiError(error)) throw error
      logger.error(`Failed to scan skill directory ${skillPath}`, { error })
    }
  }

  logger.info(`Scanned ${owner}/${repo}`, { filesFound: foundFiles.length })
  return foundFiles
}

export async function getRepoDefaultBranch(
  token: string | null,
  owner: string,
  repo: string
): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: githubHeaders(token),
  })

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`)
  }

  const data = (await response.json()) as GitHubRepoResponse
  return data.default_branch
}

export async function fetchFileContent(
  downloadUrl: string,
  token?: string | null
): Promise<string> {
  const headers: Record<string, string> = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(downloadUrl, { headers })

  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`)
  }

  return response.text()
}

type SkillDirectoryFile = {
  name: string
  content: string
}

/**
 * Fetch all files from a skill directory on GitHub.
 * Lists the directory contents via the GitHub Contents API, then fetches
 * each file's content. Only fetches files (not subdirectories).
 */
export async function fetchSkillDirectoryFiles(
  token: string | null,
  owner: string,
  repo: string,
  dirPath: string
): Promise<SkillDirectoryFile[]> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}`,
    {
      headers: githubHeaders(token),
    }
  )

  if (!response.ok) {
    logger.warn('Failed to list skill directory contents', {
      owner,
      repo,
      dirPath,
      status: response.status,
    })
    return []
  }

  const entries = (await response.json()) as GitHubContentResponse[]
  const files: SkillDirectoryFile[] = []

  for (const entry of entries) {
    if (entry.type !== 'file' || !entry.download_url) continue

    try {
      const content = await fetchFileContent(entry.download_url, token)
      files.push({ name: entry.name, content })
    } catch (error) {
      logger.warn('Failed to fetch file from skill directory', {
        path: entry.path,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return files
}
