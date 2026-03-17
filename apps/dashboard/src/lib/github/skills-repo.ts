import { createLogger } from '@agentver/shared'

const logger = createLogger('github:skills-repo')

const GITHUB_API_BASE = 'https://api.github.com'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GitHubContentItem = {
  name: string
  path: string
  type: 'file' | 'dir' | 'symlink' | 'submodule'
  size: number
  sha: string
  download_url: string | null
  content?: string
  encoding?: string
}

type GitHubRepoResponse = {
  default_branch: string
  permissions?: {
    admin: boolean
    push: boolean
    pull: boolean
  }
}

type GitHubRefResponse = {
  object: {
    sha: string
    type: string
  }
}

type GitHubCommitResponse = {
  sha: string
  tree: {
    sha: string
  }
}

type GitHubTreeEntry = {
  path: string
  mode: '100644' | '100755' | '040000' | '160000' | '120000'
  type: 'blob' | 'tree' | 'commit'
  sha?: string
  content?: string
}

type GitHubTreeResponse = {
  sha: string
}

type GitHubCreateCommitResponse = {
  sha: string
}

export type RepoContentsResult = {
  type: 'file' | 'dir'
  name: string
  path: string
  sha: string
  size: number
  content?: string
  downloadUrl?: string
  entries?: Array<{
    name: string
    path: string
    type: 'file' | 'dir' | 'symlink' | 'submodule'
    size: number
    sha: string
  }>
}

export type CommitFilesInput = {
  path: string
  content: string
}

export type CommitResult = {
  sha: string
  branch: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  }
}

type GitHubApiErrorBody = {
  message: string
  documentation_url?: string
}

async function githubFetch<T>(url: string, token: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...githubHeaders(token),
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ message: 'Unknown error' }))) as GitHubApiErrorBody
    logger.error('GitHub API request failed', {
      url,
      status: response.status,
      message: body.message,
    })
    throw new Error(`GitHub API error (${response.status}): ${body.message}`)
  }

  return response.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the contents of a file or directory from a GitHub repository.
 * For files, returns base64-decoded content. For directories, returns entries.
 */
export async function getRepoContents(
  owner: string,
  repo: string,
  path: string,
  ref?: string,
  token?: string
): Promise<RepoContentsResult> {
  const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}${refParam}`

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ message: 'Unknown error' }))) as GitHubApiErrorBody
    throw new Error(`GitHub API error (${response.status}): ${body.message}`)
  }

  const data = (await response.json()) as GitHubContentItem | GitHubContentItem[]

  // Directory listing
  if (Array.isArray(data)) {
    return {
      type: 'dir',
      name: path.split('/').pop() ?? path,
      path,
      sha: '',
      size: 0,
      entries: data.map((item) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        sha: item.sha,
      })),
    }
  }

  // Single file
  let decodedContent: string | undefined
  if (data.content && data.encoding === 'base64') {
    decodedContent = Buffer.from(data.content, 'base64').toString('utf-8')
  }

  return {
    type: 'file',
    name: data.name,
    path: data.path,
    sha: data.sha,
    size: data.size,
    content: decodedContent,
    downloadUrl: data.download_url ?? undefined,
  }
}

/**
 * Commit multiple files to a repository using the Git Trees API.
 * This creates a single commit containing all file changes.
 */
export async function commitFiles(
  owner: string,
  repo: string,
  files: CommitFilesInput[],
  message: string,
  branch: string,
  token: string
): Promise<CommitResult> {
  // 1. Get the latest commit SHA for the branch
  const refData = await githubFetch<GitHubRefResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    token
  )
  const latestCommitSha = refData.object.sha

  // 2. Get the tree SHA of the latest commit
  const commitData = await githubFetch<GitHubCommitResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits/${latestCommitSha}`,
    token
  )
  const baseTreeSha = commitData.tree.sha

  // 3. Create a new tree with the file changes
  const treeEntries: GitHubTreeEntry[] = files.map((file) => ({
    path: file.path,
    mode: '100644',
    type: 'blob',
    content: file.content,
  }))

  const newTree = await githubFetch<GitHubTreeResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries,
      }),
    }
  )

  // 4. Create the commit
  const newCommit = await githubFetch<GitHubCreateCommitResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: newTree.sha,
        parents: [latestCommitSha],
      }),
    }
  )

  // 5. Update the branch reference
  await githubFetch<GitHubRefResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify({
        sha: newCommit.sha,
      }),
    }
  )

  logger.info('Files committed to repository', {
    owner,
    repo,
    branch,
    fileCount: files.length,
    commitSha: newCommit.sha,
  })

  return {
    sha: newCommit.sha,
    branch,
  }
}

/**
 * Create a new branch from an existing ref.
 */
export async function createBranch(
  owner: string,
  repo: string,
  branchName: string,
  fromRef: string,
  token: string
): Promise<void> {
  // Resolve the source ref to a SHA
  const refData = await githubFetch<GitHubRefResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(fromRef)}`,
    token
  )

  await githubFetch<GitHubRefResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: refData.object.sha,
      }),
    }
  )

  logger.info('Branch created', { owner, repo, branchName, fromRef })
}

/**
 * Validate that the provided token has push access to the repository.
 */
export async function validateRepoAccess(
  owner: string,
  repo: string,
  token: string
): Promise<boolean> {
  try {
    const repoData = await githubFetch<GitHubRepoResponse>(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
      token
    )

    const hasPushAccess = repoData.permissions?.push ?? false

    logger.info('Repository access validated', {
      owner,
      repo,
      hasPushAccess,
    })

    return hasPushAccess
  } catch (error) {
    logger.warn('Repository access validation failed', {
      owner,
      repo,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Get the default branch name for a repository.
 */
export async function getDefaultBranch(
  owner: string,
  repo: string,
  token?: string
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, { headers })

  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ message: 'Unknown error' }))) as GitHubApiErrorBody
    throw new Error(`GitHub API error (${response.status}): ${body.message}`)
  }

  const data = (await response.json()) as GitHubRepoResponse
  return data.default_branch
}

/**
 * Delete a skill's directory from a GitHub repository.
 *
 * Lists files under `skillPath`, then creates a single commit that removes
 * them all using the Git Trees API (setting each entry's SHA to null).
 */
export async function deleteSkillFromGitHub(
  owner: string,
  repo: string,
  skillPath: string,
  message: string,
  token: string
): Promise<void> {
  // 1. Resolve the default branch
  let branch: string
  try {
    branch = await getDefaultBranch(owner, repo, token)
  } catch {
    branch = 'main'
  }

  // 2. Get the latest commit and its tree
  const refData = await githubFetch<GitHubRefResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    token
  )
  const latestCommitSha = refData.object.sha

  const commitData = await githubFetch<GitHubCommitResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits/${latestCommitSha}`,
    token
  )
  const baseTreeSha = commitData.tree.sha

  // 3. List files under the skill path so we know what to remove
  const contents = await getRepoContents(owner, repo, skillPath, undefined, token)
  const filePaths: string[] = []

  if (contents.type === 'dir' && contents.entries) {
    for (const entry of contents.entries) {
      if (entry.type === 'file') {
        filePaths.push(entry.path)
      }
    }
  } else if (contents.type === 'file') {
    filePaths.push(contents.path)
  }

  if (filePaths.length === 0) {
    logger.warn('No files found under skill path — nothing to delete', { owner, repo, skillPath })
    return
  }

  // 4. Create a new tree that removes the files (sha: null deletes the entry)
  const newTree = await githubFetch<GitHubTreeResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: filePaths.map((path) => ({
          path,
          mode: '100644',
          type: 'blob',
          sha: null,
        })),
      }),
    }
  )

  // 5. Create the commit
  const newCommit = await githubFetch<GitHubCreateCommitResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: newTree.sha,
        parents: [latestCommitSha],
      }),
    }
  )

  // 6. Update the branch ref
  await githubFetch<GitHubRefResponse>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha }),
    }
  )

  logger.info('Skill deleted from GitHub repository', {
    owner,
    repo,
    skillPath,
    deletedFiles: filePaths.length,
    commitSha: newCommit.sha,
  })
}
