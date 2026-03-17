import { createLogger } from '@agentver/shared'

import type {
  CommitEntry,
  DraftEntry,
  GitProvider,
  SkillFile,
  SkillFileEntry,
  VersionEntry,
} from '../types'

const logger = createLogger('git:forgejo')

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILLS_REPO = 'skills'
const DEFAULT_BRANCH = 'main'
const DRAFT_PREFIX = 'draft/'
const SUGGESTION_PREFIX = 'suggestion/'
const VERSION_PREFIX = 'v/'

// ---------------------------------------------------------------------------
// Forgejo REST API response types
// ---------------------------------------------------------------------------

type ForgejoOrg = {
  id: number
  username: string
  full_name: string
  description: string
  visibility: string
  avatar_url: string
}

type ForgejoRepo = {
  id: number
  name: string
  full_name: string
  description: string
  private: boolean
  default_branch: string
  empty: boolean
  size: number
  clone_url: string
  ssh_url: string
  html_url: string
  created_at: string
  updated_at: string
}

type ForgejoFileContent = {
  name: string
  path: string
  sha: string
  size: number
  content: string
  encoding: string
  type: string
  url: string
  html_url: string
  download_url: string
}

type ForgejoContentEntry = {
  name: string
  path: string
  sha: string
  size: number
  type: 'file' | 'dir' | 'symlink'
  url: string
}

type ForgejoCommit = {
  sha: string
  created: string
  commit: {
    message: string
    author: { name: string; email: string; date: string }
    committer: { name: string; email: string; date: string }
  }
  html_url: string
}

type ForgejoBranch = {
  name: string
  commit: { id: string; message: string }
  protected: boolean
}

type ForgejoTag = {
  name: string
  id: string
  message: string
  commit: { sha: string; url: string }
}

type ForgejoFileResponse = {
  content: ForgejoFileContent
  commit: ForgejoCommit
}

type ForgejoFileDeleteResponse = {
  commit: ForgejoCommit
  content: null
}

type ForgejoPullRequest = {
  number: number
  title: string
  state: string
  merged: boolean
  merge_commit_sha: string | null
  html_url: string
}

type ForgejoApiErrorBody = {
  message: string
  url: string
}

// ---------------------------------------------------------------------------
// ForgejoApiError
// ---------------------------------------------------------------------------

export class ForgejoApiError extends Error {
  public readonly url: string
  public readonly status: number

  constructor(message: string, url: string, status: number) {
    super(message)
    this.name = 'ForgejoApiError'
    this.url = url
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// ForgejoClient (private implementation detail)
// ---------------------------------------------------------------------------

class ForgejoClient {
  private readonly baseUrl: string
  private readonly token: string

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.token = token
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `token ${this.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { rawResponse?: boolean }
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`

    const init: RequestInit = {
      method,
      headers: this.headers(),
    }

    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }

    const response = await fetch(url, init)

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({
        message: 'Unknown error',
        url,
      }))) as ForgejoApiErrorBody

      logger.error('Forgejo API request failed', {
        url,
        method,
        status: response.status,
        message: errorBody.message,
      })

      throw new ForgejoApiError(errorBody.message, url, response.status)
    }

    if (options?.rawResponse) {
      return response.text() as unknown as T
    }

    if (response.status === 204) {
      return undefined as T
    }

    return response.json() as Promise<T>
  }

  private async requestNullable<T>(method: string, path: string): Promise<T | null> {
    const url = `${this.baseUrl}/api/v1${path}`

    const response = await fetch(url, {
      method,
      headers: this.headers(),
    })

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({
        message: 'Unknown error',
        url,
      }))) as ForgejoApiErrorBody

      logger.error('Forgejo API request failed', {
        url,
        method,
        status: response.status,
        message: errorBody.message,
      })

      throw new ForgejoApiError(errorBody.message, url, response.status)
    }

    return response.json() as Promise<T>
  }

  // Organisations
  async createOrg(
    name: string,
    fullName: string,
    visibility: 'public' | 'private' = 'private'
  ): Promise<ForgejoOrg> {
    return this.request<ForgejoOrg>('POST', '/orgs', {
      username: name,
      full_name: fullName,
      visibility,
    })
  }

  async getOrg(name: string): Promise<ForgejoOrg | null> {
    return this.requestNullable<ForgejoOrg>('GET', `/orgs/${encodeURIComponent(name)}`)
  }

  async deleteOrg(name: string): Promise<void> {
    await this.request<void>('DELETE', `/orgs/${encodeURIComponent(name)}`)
  }

  // Repositories
  async createRepo(
    org: string,
    name: string,
    options?: { description?: string; private?: boolean; defaultBranch?: string }
  ): Promise<ForgejoRepo> {
    return this.request<ForgejoRepo>('POST', `/orgs/${encodeURIComponent(org)}/repos`, {
      name,
      description: options?.description ?? '',
      private: options?.private ?? true,
      default_branch: options?.defaultBranch ?? 'main',
      auto_init: true,
    })
  }

  async getRepo(owner: string, repo: string): Promise<ForgejoRepo | null> {
    return this.requestNullable<ForgejoRepo>(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    )
  }

  async deleteRepo(owner: string, repo: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    )
  }

  // File contents
  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<ForgejoFileContent | null> {
    const encodedPath = path
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/')
    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : ''

    return this.requestNullable<ForgejoFileContent>(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}${refParam}`
    )
  }

  async createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    options?: { branch?: string; sha?: string }
  ): Promise<ForgejoFileResponse> {
    const encodedPath = path
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/')

    const base64Content = Buffer.from(content, 'utf-8').toString('base64')

    const body: Record<string, unknown> = {
      content: base64Content,
      message,
    }

    if (options?.branch) {
      body.branch = options.branch
    }
    if (options?.sha) {
      body.sha = options.sha
    }

    const method = options?.sha ? 'PUT' : 'POST'

    return this.request<ForgejoFileResponse>(
      method,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
      body
    )
  }

  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    sha: string,
    message: string,
    branch?: string
  ): Promise<ForgejoFileDeleteResponse> {
    const encodedPath = path
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/')

    const body: Record<string, unknown> = { sha, message }
    if (branch) {
      body.branch = branch
    }

    return this.request<ForgejoFileDeleteResponse>(
      'DELETE',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
      body
    )
  }

  async listContents(
    owner: string,
    repo: string,
    path?: string,
    ref?: string
  ): Promise<ForgejoContentEntry[]> {
    const encodedPath = path
      ? `/${path
          .split('/')
          .map((s) => encodeURIComponent(s))
          .join('/')}`
      : ''
    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : ''

    return this.request<ForgejoContentEntry[]>(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${encodedPath}${refParam}`
    )
  }

  // Commits
  async getCommits(
    owner: string,
    repo: string,
    options?: { sha?: string; limit?: number; page?: number; path?: string }
  ): Promise<ForgejoCommit[]> {
    const params = new URLSearchParams()
    if (options?.sha) params.set('sha', options.sha)
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.page) params.set('page', String(options.page))
    if (options?.path) params.set('path', options.path)

    const query = params.toString()
    const suffix = query ? `?${query}` : ''

    return this.request<ForgejoCommit[]>(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits${suffix}`
    )
  }

  // Branches
  async getBranches(owner: string, repo: string): Promise<ForgejoBranch[]> {
    return this.request<ForgejoBranch[]>(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`
    )
  }

  async createBranch(
    owner: string,
    repo: string,
    name: string,
    from?: string
  ): Promise<ForgejoBranch> {
    const body: Record<string, string> = { new_branch_name: name }
    if (from) {
      body.old_branch_name = from
    }

    return this.request<ForgejoBranch>(
      'POST',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
      body
    )
  }

  async deleteBranch(owner: string, repo: string, name: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(name)}`
    )
  }

  // Tags
  async getTags(owner: string, repo: string): Promise<ForgejoTag[]> {
    return this.request<ForgejoTag[]>(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags`
    )
  }

  async createTag(
    owner: string,
    repo: string,
    name: string,
    target: string,
    message?: string
  ): Promise<ForgejoTag> {
    return this.request<ForgejoTag>(
      'POST',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags`,
      {
        tag_name: name,
        target,
        message: message ?? '',
      }
    )
  }

  // Diff & Merge
  async getDiff(owner: string, repo: string, base: string, head: string): Promise<string> {
    return this.request<string>(
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}.diff`,
      undefined,
      { rawResponse: true }
    )
  }

  async mergeBranches(
    owner: string,
    repo: string,
    base: string,
    head: string,
    message: string
  ): Promise<ForgejoCommit> {
    const ownerEnc = encodeURIComponent(owner)
    const repoEnc = encodeURIComponent(repo)
    const repoPath = `/repos/${ownerEnc}/${repoEnc}`

    const pr = await this.request<ForgejoPullRequest>('POST', `${repoPath}/pulls`, {
      title: message,
      head,
      base,
    })

    try {
      await this.request<void>('POST', `${repoPath}/pulls/${pr.number}/merge`, {
        Do: 'merge',
        MergeTitleField: message,
        MergeMessageField: message,
        delete_branch_after_merge: false,
      })
    } catch (error) {
      try {
        await this.request<void>('PATCH', `${repoPath}/pulls/${pr.number}`, {
          state: 'closed',
        })
      } catch (closeError) {
        logger.error('Failed to close orphaned PR after merge failure', {
          owner,
          repo,
          prNumber: pr.number,
          closeError,
        })
      }
      throw error
    }

    const merged = await this.request<ForgejoPullRequest>('GET', `${repoPath}/pulls/${pr.number}`)

    if (!merged.merge_commit_sha) {
      throw new ForgejoApiError(
        'Merge completed but no merge commit SHA returned',
        `${repoPath}/pulls/${pr.number}`,
        500
      )
    }

    return this.request<ForgejoCommit>(
      'GET',
      `${repoPath}/git/commits/${encodeURIComponent(merged.merge_commit_sha)}`
    )
  }
}

// ---------------------------------------------------------------------------
// ForgejoGitProvider
// ---------------------------------------------------------------------------

export class ForgejoGitProvider implements GitProvider {
  private readonly client: ForgejoClient

  constructor(baseUrl: string, token: string) {
    this.client = new ForgejoClient(baseUrl, token)
  }

  // -------------------------------------------------------------------------
  // Namespace management
  // -------------------------------------------------------------------------

  async createNamespace(slug: string, displayName: string): Promise<void> {
    const existing = await this.client.getOrg(slug)
    if (!existing) {
      await this.client.createOrg(slug, displayName, 'private')
      logger.info('Namespace org created', { slug, displayName })
    }

    // Always ensure the skills repo exists — the org may have been created
    // on a previous attempt that failed before repo creation completed.
    await this.ensureSkillsRepo(slug)

    logger.info('Namespace ready', { slug, displayName })
  }

  async deleteNamespace(slug: string): Promise<void> {
    const repo = await this.client.getRepo(slug, SKILLS_REPO)
    if (repo) {
      await this.client.deleteRepo(slug, SKILLS_REPO)
    }

    const org = await this.client.getOrg(slug)
    if (org) {
      await this.client.deleteOrg(slug)
    }

    logger.info('Namespace deleted', { slug })
  }

  // -------------------------------------------------------------------------
  // Skill operations
  // -------------------------------------------------------------------------

  async createSkill(
    namespace: string,
    skillName: string,
    files: SkillFile[],
    message?: string
  ): Promise<{ commitSha: string }> {
    await this.ensureSkillsRepo(namespace)

    const commitMessage = message ?? `Add skill: ${skillName}`
    let lastCommitSha = ''
    const committedFiles: string[] = []

    try {
      for (const file of files) {
        const filePath = `${skillName}/${file.path}`
        const result = await this.client.createOrUpdateFile(
          namespace,
          SKILLS_REPO,
          filePath,
          file.content,
          commitMessage
        )
        committedFiles.push(filePath)
        lastCommitSha = result.commit.sha
      }
    } catch (error) {
      if (committedFiles.length > 0) {
        await this.rollbackCommittedFiles(namespace, committedFiles, `Rollback: ${commitMessage}`)
      }
      throw error
    }

    logger.info('Skill created', { namespace, skillName, fileCount: files.length })
    return { commitSha: lastCommitSha }
  }

  async updateSkillFile(
    namespace: string,
    skillName: string,
    filePath: string,
    content: string,
    message: string
  ): Promise<{ commitSha: string }> {
    const fullPath = `${skillName}/${filePath}`

    const existing = await this.client.getFileContent(namespace, SKILLS_REPO, fullPath)
    const sha = existing?.sha

    try {
      const result = await this.client.createOrUpdateFile(
        namespace,
        SKILLS_REPO,
        fullPath,
        content,
        message,
        { sha }
      )

      logger.info('Skill file updated', { namespace, skillName, filePath })
      return { commitSha: result.commit.sha }
    } catch (error) {
      if (error instanceof ForgejoApiError && error.status === 409) {
        logger.warn('SHA conflict on updateSkillFile, retrying with fresh SHA', {
          namespace,
          skillName,
          filePath,
        })

        const fresh = await this.client.getFileContent(namespace, SKILLS_REPO, fullPath)
        const result = await this.client.createOrUpdateFile(
          namespace,
          SKILLS_REPO,
          fullPath,
          content,
          message,
          { sha: fresh?.sha }
        )

        logger.info('Skill file updated after SHA conflict retry', {
          namespace,
          skillName,
          filePath,
        })
        return { commitSha: result.commit.sha }
      }

      throw error
    }
  }

  async getSkillFile(
    namespace: string,
    skillName: string,
    filePath: string,
    ref?: string
  ): Promise<string | null> {
    const fullPath = `${skillName}/${filePath}`
    const file = await this.client.getFileContent(namespace, SKILLS_REPO, fullPath, ref)

    if (!file) {
      return null
    }

    return Buffer.from(file.content, 'base64').toString('utf-8')
  }

  async listSkillFiles(
    namespace: string,
    skillName: string,
    ref?: string
  ): Promise<SkillFileEntry[]> {
    try {
      const entries = await this.client.listContents(namespace, SKILLS_REPO, skillName, ref)
      return flattenEntries(entries, skillName)
    } catch (error) {
      if (isNotFoundError(error)) {
        return []
      }
      throw error
    }
  }

  async deleteSkill(namespace: string, skillName: string, message: string): Promise<void> {
    const allFiles = await this.listSkillFilesRecursive(namespace, skillName)

    for (const file of allFiles) {
      await this.client.deleteFile(
        namespace,
        SKILLS_REPO,
        `${skillName}/${file.path}`,
        file.sha,
        message
      )
    }

    logger.info('Skill deleted', { namespace, skillName, fileCount: allFiles.length })
  }

  async removeSkillFile(
    namespace: string,
    skillName: string,
    filePath: string,
    message: string
  ): Promise<{ commitSha: string }> {
    const fullPath = `${skillName}/${filePath}`

    const existing = await this.client.getFileContent(namespace, SKILLS_REPO, fullPath)
    if (!existing) {
      throw new ForgejoApiError(
        `File not found: ${filePath}`,
        `${namespace}/${SKILLS_REPO}/${fullPath}`,
        404
      )
    }

    const result = await this.client.deleteFile(
      namespace,
      SKILLS_REPO,
      fullPath,
      existing.sha,
      message
    )

    logger.info('Skill file removed', { namespace, skillName, filePath })
    return { commitSha: result.commit.sha }
  }

  // -------------------------------------------------------------------------
  // Version control
  // -------------------------------------------------------------------------

  async getHistory(
    namespace: string,
    skillName: string,
    options?: { limit?: number; ref?: string }
  ): Promise<CommitEntry[]> {
    const commits = await this.client.getCommits(namespace, SKILLS_REPO, {
      sha: options?.ref ?? DEFAULT_BRANCH,
      limit: options?.limit ?? 50,
      path: skillName,
    })

    return commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: {
        name: c.commit.author.name,
        email: c.commit.author.email,
        date: c.commit.author.date,
      },
      createdAt: c.created,
    }))
  }

  async createDraft(namespace: string, skillName: string, draftName: string): Promise<void> {
    const branchName = `${DRAFT_PREFIX}${skillName}/${draftName}`
    await this.client.createBranch(namespace, SKILLS_REPO, branchName, DEFAULT_BRANCH)
    logger.info('Draft created', { namespace, skillName, draftName, branchName })
  }

  async listDrafts(namespace: string): Promise<DraftEntry[]> {
    const branches = await this.client.getBranches(namespace, SKILLS_REPO)

    return branches
      .filter((b) => b.name.startsWith(DRAFT_PREFIX))
      .map((b) => ({
        name: b.name.slice(DRAFT_PREFIX.length),
        branchName: b.name,
        latestCommitId: b.commit.id,
        latestMessage: b.commit.message,
      }))
  }

  async mergeDraft(
    namespace: string,
    draftName: string,
    message: string
  ): Promise<{ commitSha: string }> {
    const commit = await this.client.mergeBranches(
      namespace,
      SKILLS_REPO,
      DEFAULT_BRANCH,
      draftName,
      message
    )

    logger.info('Draft merged', { namespace, draftName, commitSha: commit.sha })
    return { commitSha: commit.sha }
  }

  async deleteDraft(namespace: string, draftName: string): Promise<void> {
    const branchName = draftName.startsWith(DRAFT_PREFIX)
      ? draftName
      : `${DRAFT_PREFIX}${draftName}`
    await this.client.deleteBranch(namespace, SKILLS_REPO, branchName)
    logger.info('Draft deleted', { namespace, draftName })
  }

  async createVersion(
    namespace: string,
    skillName: string,
    version: string,
    message: string,
    commitSha: string
  ): Promise<void> {
    const tagName = `${VERSION_PREFIX}${skillName}/${version}`
    await this.client.createTag(namespace, SKILLS_REPO, tagName, commitSha, message)
    logger.info('Version created', { namespace, skillName, version, tagName })
  }

  async listVersions(namespace: string): Promise<VersionEntry[]> {
    const tags = await this.client.getTags(namespace, SKILLS_REPO)

    return tags
      .filter((t) => t.name.startsWith(VERSION_PREFIX))
      .map((t) => ({
        name: t.name.slice(VERSION_PREFIX.length),
        tag: t.name,
        commitSha: t.commit.sha,
        message: t.message,
      }))
  }

  // -------------------------------------------------------------------------
  // Suggestions (proposals)
  // -------------------------------------------------------------------------

  async createSuggestionBranch(
    namespace: string,
    proposalId: string
  ): Promise<{ branchName: string; baseSha: string }> {
    const branchName = `${SUGGESTION_PREFIX}${proposalId}`
    const branch = await this.client.createBranch(
      namespace,
      SKILLS_REPO,
      branchName,
      DEFAULT_BRANCH
    )
    const baseSha = branch.commit.id

    logger.info('Suggestion branch created', { namespace, proposalId, branchName, baseSha })
    return { branchName, baseSha }
  }

  async commitFilesToBranch(
    namespace: string,
    branchName: string,
    files: SkillFile[],
    message: string
  ): Promise<{ commitSha: string }> {
    let lastCommitSha = ''
    const committedFiles: string[] = []

    try {
      for (const file of files) {
        const existing = await this.client.getFileContent(
          namespace,
          SKILLS_REPO,
          file.path,
          branchName
        )

        const result = await this.client.createOrUpdateFile(
          namespace,
          SKILLS_REPO,
          file.path,
          file.content,
          message,
          { branch: branchName, sha: existing?.sha }
        )
        committedFiles.push(file.path)
        lastCommitSha = result.commit.sha
      }
    } catch (error) {
      if (committedFiles.length > 0) {
        await this.rollbackCommittedFiles(
          namespace,
          committedFiles,
          `Rollback: ${message}`,
          branchName
        )
      }
      throw error
    }

    logger.info('Files committed to branch', {
      namespace,
      branchName,
      fileCount: files.length,
    })
    return { commitSha: lastCommitSha }
  }

  async deleteSuggestionBranch(namespace: string, proposalId: string): Promise<void> {
    const branchName = `${SUGGESTION_PREFIX}${proposalId}`
    await this.client.deleteBranch(namespace, SKILLS_REPO, branchName)
    logger.info('Suggestion branch deleted', { namespace, proposalId })
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  async getHeadSha(namespace: string): Promise<string> {
    const commits = await this.client.getCommits(namespace, SKILLS_REPO, {
      sha: DEFAULT_BRANCH,
      limit: 1,
    })

    if (commits.length === 0) {
      throw new Error(`No commits found on ${DEFAULT_BRANCH} for ${namespace}/${SKILLS_REPO}`)
    }

    return commits[0]!.sha
  }

  async getDiff(namespace: string, base: string, head: string): Promise<string> {
    return this.client.getDiff(namespace, SKILLS_REPO, base, head)
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async rollbackCommittedFiles(
    namespace: string,
    filePaths: string[],
    message: string,
    branch?: string
  ): Promise<void> {
    logger.warn('Skill creation failed mid-way, cleaning up committed files', {
      namespace,
      filePaths,
    })

    for (const path of filePaths) {
      try {
        const existing = await this.client.getFileContent(namespace, SKILLS_REPO, path, branch)
        if (existing?.sha) {
          await this.client.deleteFile(namespace, SKILLS_REPO, path, existing.sha, message, branch)
        }
      } catch (cleanupError) {
        logger.error('Failed to clean up file during rollback', {
          namespace,
          path,
          cleanupError,
        })
      }
    }
  }

  private async listSkillFilesRecursive(
    namespace: string,
    skillName: string,
    subPath?: string
  ): Promise<SkillFileEntry[]> {
    const dirPath = subPath ? `${skillName}/${subPath}` : skillName
    let entries: ForgejoContentEntry[]

    try {
      entries = await this.client.listContents(namespace, SKILLS_REPO, dirPath)
    } catch (error) {
      if (isNotFoundError(error)) {
        return []
      }
      throw error
    }

    const result: SkillFileEntry[] = []

    for (const entry of entries) {
      const relativePath = entry.path.startsWith(`${skillName}/`)
        ? entry.path.slice(skillName.length + 1)
        : entry.path

      if (entry.type === 'file') {
        result.push({
          name: entry.name,
          path: relativePath,
          sha: entry.sha,
          size: entry.size,
          type: entry.type,
        })
      } else if (entry.type === 'dir') {
        const nested = await this.listSkillFilesRecursive(namespace, skillName, relativePath)
        result.push(...nested)
      }
    }

    return result
  }

  private async ensureSkillsRepo(namespace: string): Promise<void> {
    const repo = await this.client.getRepo(namespace, SKILLS_REPO)
    if (repo) {
      return
    }

    await this.client.createRepo(namespace, SKILLS_REPO, {
      description: `Skills repository for ${namespace}`,
      private: true,
      defaultBranch: DEFAULT_BRANCH,
    })

    logger.info('Skills repo created on demand', { namespace })
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function flattenEntries(entries: ForgejoContentEntry[], prefix: string): SkillFileEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path.startsWith(`${prefix}/`) ? entry.path.slice(prefix.length + 1) : entry.path,
    sha: entry.sha,
    size: entry.size,
    type: entry.type,
  }))
}

function isNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    return (error as ForgejoApiError).status === 404
  }
  return false
}
