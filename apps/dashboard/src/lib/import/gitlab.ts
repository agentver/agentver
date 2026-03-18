import type { DetectedFileType } from '@agentver/agent-definitions'
import { createLogger } from '@agentver/shared'

const logger = createLogger('gitlab-import')

type GitLabTokenResponse = {
  access_token: string
  token_type: string
  refresh_token?: string
  expires_in: number
  scope: string
  created_at: number
  error?: string
  error_description?: string
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function refreshGitLabToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken?: string
  expiresAt: Date
}> {
  const clientId = process.env.GITLAB_CLIENT_ID
  const clientSecret = process.env.GITLAB_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('GitLab OAuth credentials not configured')
  }

  const response = await fetch('https://gitlab.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    throw new Error(`GitLab token refresh failed: ${response.status}`)
  }

  const data = (await response.json()) as GitLabTokenResponse

  if (data.error) {
    throw new Error(`GitLab token refresh error: ${data.error_description ?? data.error}`)
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}

// ---------------------------------------------------------------------------
// GitLab API types
// ---------------------------------------------------------------------------

type GitLabProject = {
  id: number
  name: string
  path_with_namespace: string
  default_branch: string
  namespace: { full_path: string }
}

type GitLabRepo = {
  projectId: number
  name: string
  fullName: string
  defaultBranch: string
}

type GitLabTreeEntry = {
  id: string
  name: string
  type: 'tree' | 'blob'
  path: string
  mode: string
}

type ScannedGitLabFile = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  projectId: number
  ref: string
}

async function gitlabFetch<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`https://gitlab.com/api/v4${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function gitlabFetchOptional<T>(accessToken: string, path: string): Promise<T | null> {
  const response = await fetch(`https://gitlab.com/api/v4${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function listGitLabRepos(accessToken: string): Promise<GitLabRepo[]> {
  const projects = await gitlabFetch<GitLabProject[]>(
    accessToken,
    '/projects?membership=true&per_page=100&order_by=updated_at&sort=desc'
  )

  return projects.map((project) => ({
    projectId: project.id,
    name: project.name,
    fullName: project.path_with_namespace,
    defaultBranch: project.default_branch,
  }))
}

export async function scanGitLabRepo(
  accessToken: string,
  projectId: number,
  defaultBranch: string
): Promise<ScannedGitLabFile[]> {
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

  const foundFiles: ScannedGitLabFile[] = []
  const ref = defaultBranch || 'main'

  // Check for config files
  for (const configEntry of configFiles) {
    try {
      const encodedPath = encodeURIComponent(configEntry.path)
      const response = await fetch(
        `https://gitlab.com/api/v4/projects/${projectId}/repository/files/${encodedPath}?ref=${ref}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )

      if (response.ok) {
        foundFiles.push({
          path: configEntry.path,
          name: configEntry.path,
          type: 'config',
          detectedType: 'AGENT_CONFIG',
          agentId: configEntry.agentId,
          projectId,
          ref,
        })
      }
    } catch (error) {
      logger.error(`Failed to check config file ${configEntry.path}`, { error })
    }
  }

  // Scan .roo/rules directory for rule files
  try {
    const rooRulesEntries = await gitlabFetchOptional<GitLabTreeEntry[]>(
      accessToken,
      `/projects/${projectId}/repository/tree?path=.roo/rules&ref=${ref}&per_page=100`
    )

    if (rooRulesEntries) {
      for (const entry of rooRulesEntries) {
        if (entry.name.endsWith('.md')) {
          foundFiles.push({
            path: entry.path,
            name: entry.name,
            type: 'config',
            detectedType: 'AGENT_CONFIG',
            agentId: 'roo-code',
            projectId,
            ref,
          })
        }
      }
    }
  } catch (error) {
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

  // Scan skill directories
  for (const skillPath of skillPaths) {
    try {
      const entries = await gitlabFetchOptional<GitLabTreeEntry[]>(
        accessToken,
        `/projects/${projectId}/repository/tree?path=${encodeURIComponent(skillPath)}&ref=${ref}&per_page=100`
      )

      if (entries) {
        const prefix = skillPath.split('/')[0] ?? ''
        const agentId = skillPathAgentMap[prefix] ?? 'copilot'

        for (const entry of entries) {
          if (entry.type === 'tree') {
            foundFiles.push({
              path: entry.path,
              name: entry.name,
              type: 'skill',
              detectedType: 'SKILL',
              agentId,
              projectId,
              ref,
            })
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to scan skill directory ${skillPath}`, { error })
    }
  }

  logger.info(`Scanned GitLab project ${projectId}`, { filesFound: foundFiles.length })
  return foundFiles
}

export async function fetchGitLabFileContent(
  accessToken: string,
  projectId: number,
  filePath: string,
  ref: string
): Promise<string> {
  const encodedPath = encodeURIComponent(filePath)
  const response = await fetch(
    `https://gitlab.com/api/v4/projects/${projectId}/repository/files/${encodedPath}/raw?ref=${ref}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch file from GitLab: ${response.status}`)
  }

  return response.text()
}
