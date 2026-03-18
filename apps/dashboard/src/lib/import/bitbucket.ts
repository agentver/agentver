import type { DetectedFileType } from '@agentver/agent-definitions'
import { createLogger } from '@agentver/shared'

const logger = createLogger('bitbucket-import')

type BitbucketTokenResponse = {
  access_token: string
  token_type: string
  refresh_token?: string
  scopes: string
  expires_in: number
  error?: string
  error_description?: string
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function refreshBitbucketToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken?: string
  expiresAt: Date
}> {
  const clientId = process.env.BITBUCKET_CLIENT_ID
  const clientSecret = process.env.BITBUCKET_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Bitbucket OAuth credentials not configured')
  }

  const response = await fetch('https://bitbucket.org/site/oauth2/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    throw new Error(`Bitbucket token refresh failed: ${response.status}`)
  }

  const data = (await response.json()) as BitbucketTokenResponse

  if (data.error) {
    throw new Error(`Bitbucket token refresh error: ${data.error_description ?? data.error}`)
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}

// ---------------------------------------------------------------------------
// Bitbucket API types
// ---------------------------------------------------------------------------

type BitbucketRepo = {
  workspace: string
  slug: string
  fullName: string
  defaultBranch: string
}

type BitbucketRepoResponse = {
  slug: string
  full_name: string
  mainbranch: { name: string } | null
  workspace: { slug: string }
}

type BitbucketPaginatedResponse<T> = {
  values: T[]
  next?: string
  page: number
  size: number
}

type BitbucketSrcEntry = {
  path: string
  type: 'commit_file' | 'commit_directory'
  size?: number
}

type ScannedBitbucketFile = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  downloadUrl: string
}

export async function listBitbucketRepos(accessToken: string): Promise<BitbucketRepo[]> {
  const repos: BitbucketRepo[] = []
  let url: string | undefined =
    'https://api.bitbucket.org/2.0/repositories?role=member&pagelen=100&sort=-updated_on'

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Bitbucket API error: ${response.status}`)
    }

    const data = (await response.json()) as BitbucketPaginatedResponse<BitbucketRepoResponse>

    for (const repo of data.values) {
      repos.push({
        workspace: repo.workspace.slug,
        slug: repo.slug,
        fullName: repo.full_name,
        defaultBranch: repo.mainbranch?.name ?? 'main',
      })
    }

    url = data.next
  }

  return repos
}

async function listDirectoryContents(
  accessToken: string,
  workspace: string,
  repoSlug: string,
  commit: string,
  path: string
): Promise<BitbucketSrcEntry[]> {
  const entries: BitbucketSrcEntry[] = []
  let url: string | undefined =
    `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/src/${commit}/${path}?pagelen=100`

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (response.status === 404) {
      return entries
    }

    if (!response.ok) {
      logger.error(`Failed to list directory contents at ${path}`, { status: response.status })
      throw new Error(`Bitbucket API error listing directory ${path}: ${response.status}`)
    }

    const data = (await response.json()) as BitbucketPaginatedResponse<BitbucketSrcEntry>
    entries.push(...data.values)
    url = data.next
  }

  return entries
}

async function fileExists(
  accessToken: string,
  workspace: string,
  repoSlug: string,
  commit: string,
  filePath: string
): Promise<boolean> {
  const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/src/${commit}/${filePath}`

  const response = await fetch(url, {
    method: 'HEAD',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  return response.ok
}

function buildDownloadUrl(
  workspace: string,
  repoSlug: string,
  commit: string,
  filePath: string
): string {
  return `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/src/${commit}/${filePath}`
}

export async function scanBitbucketRepo(
  accessToken: string,
  workspace: string,
  repoSlug: string,
  mainBranch: string
): Promise<ScannedBitbucketFile[]> {
  const commit = mainBranch

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

  const foundFiles: ScannedBitbucketFile[] = []

  // Check config files
  for (const configEntry of configFiles) {
    try {
      const exists = await fileExists(accessToken, workspace, repoSlug, commit, configEntry.path)

      if (exists) {
        foundFiles.push({
          path: configEntry.path,
          name: configEntry.path,
          type: 'config',
          detectedType: 'AGENT_CONFIG',
          agentId: configEntry.agentId,
          downloadUrl: buildDownloadUrl(workspace, repoSlug, commit, configEntry.path),
        })
      }
    } catch (error) {
      logger.error(`Failed to check config file ${configEntry.path}`, { error })
    }
  }

  // Scan .roo/rules directory for rule files
  try {
    const rooRulesEntries = await listDirectoryContents(
      accessToken,
      workspace,
      repoSlug,
      commit,
      '.roo/rules'
    )

    for (const entry of rooRulesEntries) {
      if (entry.type === 'commit_file' && entry.path.endsWith('.md')) {
        const fileName = entry.path.split('/').pop() ?? entry.path
        foundFiles.push({
          path: entry.path,
          name: fileName,
          type: 'config',
          detectedType: 'AGENT_CONFIG',
          agentId: 'roo-code',
          downloadUrl: buildDownloadUrl(workspace, repoSlug, commit, entry.path),
        })
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
      const entries = await listDirectoryContents(
        accessToken,
        workspace,
        repoSlug,
        commit,
        skillPath
      )

      const prefix = skillPath.split('/')[0] ?? ''
      const agentId = skillPathAgentMap[prefix] ?? 'copilot'

      for (const entry of entries) {
        if (entry.type === 'commit_directory') {
          foundFiles.push({
            path: entry.path,
            name: entry.path.split('/').pop() ?? entry.path,
            type: 'skill',
            detectedType: 'SKILL',
            agentId,
            downloadUrl: '',
          })
        }
      }
    } catch (error) {
      logger.error(`Failed to scan skill directory ${skillPath}`, { error })
    }
  }

  logger.info(`Scanned ${workspace}/${repoSlug}`, { filesFound: foundFiles.length })
  return foundFiles
}

export async function fetchBitbucketFileContent(
  accessToken: string,
  workspace: string,
  repoSlug: string,
  filePath: string,
  commit: string
): Promise<string> {
  const url = buildDownloadUrl(workspace, repoSlug, commit, filePath)

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'text/plain',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`)
  }

  return response.text()
}
