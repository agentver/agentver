import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { AgentverError, createLogger } from '@agentver/shared'
import { cacheFiles, getCachedFiles } from './cache.js'
import type { FetchedFile, FetchResult, FetchStrategy, GitSource, ResolvedRef } from './types.js'

const logger = createLogger('git:fetcher')

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 60_000
const HTTP_TIMEOUT_MS = 15_000
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

const STRATEGIES: Array<{
  name: FetchStrategy
  fn: (resolved: ResolvedRef) => Promise<FetchedFile[]>
}> = [
  { name: 'api', fn: fetchViaApi },
  { name: 'archive', fn: fetchViaArchive },
  { name: 'sparse-checkout', fn: fetchViaSparseCheckout },
  { name: 'clone', fn: fetchViaClone },
]

export async function fetchFiles(resolved: ResolvedRef): Promise<FetchResult> {
  const cached = getCachedFiles(resolved.source, resolved.commitSha)
  if (cached) {
    logger.info('Using cached files')
    return { files: cached, commitSha: resolved.commitSha, source: resolved.source }
  }

  for (const strategy of STRATEGIES) {
    logger.info(`Trying fetch strategy: ${strategy.name}`)

    try {
      const files = await strategy.fn(resolved)
      cacheFiles(resolved.source, resolved.commitSha, files)
      return { files, commitSha: resolved.commitSha, source: resolved.source }
    } catch (error) {
      logger.warn(`Strategy "${strategy.name}" failed: ${String(error)}`)
    }
  }

  throw new AgentverError(
    'INTERNAL_ERROR',
    `All fetch strategies exhausted for ${resolved.source.host}/${resolved.source.owner}/${resolved.source.repo}`
  )
}

export function buildRepoUrl(source: GitSource): string {
  return `https://${source.host}/${source.owner}/${source.repo}.git`
}

export async function execGit(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024,
    })
    return stdout
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new AgentverError(
      'INTERNAL_ERROR',
      `Git command failed: git ${args.join(' ')} — ${message}`
    )
  }
}

export async function readFilesFromDirectory(
  dirPath: string,
  basePath = ''
): Promise<FetchedFile[]> {
  const files: FetchedFile[] = []

  let entries: Dirent[]
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch (error) {
    if (isEnoent(error)) return []
    throw error
  }

  for (const entry of entries) {
    const name = String(entry.name)
    if (name === '.git') continue

    const fullPath = join(dirPath, name)
    const relativePath = basePath ? `${basePath}/${name}` : name

    if (entry.isDirectory()) {
      const nested = await readFilesFromDirectory(fullPath, relativePath)
      files.push(...nested)
      continue
    }

    if (!entry.isFile()) continue

    try {
      const fileStat = await stat(fullPath)
      if (fileStat.size > MAX_FILE_SIZE_BYTES) {
        logger.debug(`Skipping large file (${fileStat.size} bytes): ${relativePath}`)
        continue
      }

      const content = await readFile(fullPath, 'utf-8')
      files.push({ path: relativePath, content, size: fileStat.size })
    } catch (error) {
      if (isEnoent(error)) continue
      logger.warn(`Failed to read file ${relativePath}: ${String(error)}`)
    }
  }

  return files
}

// --- Strategy implementations ---

async function fetchViaApi(resolved: ResolvedRef): Promise<FetchedFile[]> {
  const { source, commitSha } = resolved

  if (source.host === 'github.com') {
    return fetchGitHubApi(source, commitSha)
  }

  if (source.host === 'gitlab.com') {
    return fetchGitLabApi(source, commitSha)
  }

  throw new AgentverError('INTERNAL_ERROR', `API fetch not supported for host: ${source.host}`)
}

async function fetchGitHubApi(source: GitSource, commitSha: string): Promise<FetchedFile[]> {
  const path = source.path || ''
  const url = `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${path}?ref=${commitSha}`

  const response = await gitHubFetch(url)

  if (!response.ok) {
    throw new AgentverError('INTERNAL_ERROR', `GitHub contents API returned ${response.status}`)
  }

  const data: unknown = await response.json()

  // Single file response
  if (!Array.isArray(data)) {
    const file = data as GitHubContentFile
    if (file.type !== 'file' || !file.content) {
      throw new AgentverError('INTERNAL_ERROR', 'Unexpected GitHub API response for single file')
    }

    const content = Buffer.from(file.content, 'base64').toString('utf-8')
    return [{ path: file.name, content, size: file.size }]
  }

  // Directory response — recursively fetch files
  const items = data as GitHubContentItem[]
  const files: FetchedFile[] = []

  for (const item of items) {
    if (item.type === 'dir') {
      const subSource: GitSource = { ...source, path: item.path }
      const subFiles = await fetchGitHubApi(subSource, commitSha)
      for (const subFile of subFiles) {
        files.push({ ...subFile, path: `${item.name}/${subFile.path}` })
      }
      continue
    }

    if (item.type !== 'file') continue

    // Files <= 1MB can be fetched via contents API directly
    if (item.size <= 1_000_000 && item.download_url) {
      const fileResponse = await gitHubFetch(
        `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${item.path}?ref=${commitSha}`
      )
      if (fileResponse.ok) {
        const fileData = (await fileResponse.json()) as GitHubContentFile
        if (fileData.content) {
          const content = Buffer.from(fileData.content, 'base64').toString('utf-8')
          const relativePath = source.path ? item.path.slice(source.path.length + 1) : item.path
          files.push({ path: relativePath, content, size: item.size })
          continue
        }
      }
    }

    // Large files — use Git Blobs API
    if (item.sha) {
      const blobUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/git/blobs/${item.sha}`
      const blobResponse = await gitHubFetch(blobUrl)
      if (blobResponse.ok) {
        const blobData = (await blobResponse.json()) as {
          content: string
          encoding: string
          size: number
        }
        if (blobData.size > MAX_FILE_SIZE_BYTES) {
          logger.debug(`Skipping large file via blob (${blobData.size} bytes): ${item.path}`)
          continue
        }
        const content =
          blobData.encoding === 'base64'
            ? Buffer.from(blobData.content, 'base64').toString('utf-8')
            : blobData.content
        const relativePath = source.path ? item.path.slice(source.path.length + 1) : item.path
        files.push({ path: relativePath, content, size: blobData.size })
      }
    }
  }

  return files
}

async function fetchGitLabApi(source: GitSource, commitSha: string): Promise<FetchedFile[]> {
  const projectId = encodeURIComponent(`${source.owner}/${source.repo}`)
  const path = source.path || ''
  const treeUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/tree?path=${encodeURIComponent(path)}&ref=${commitSha}&recursive=true&per_page=100`

  const headers: Record<string, string> = { 'User-Agent': 'agentver-cli' }
  const token = process.env.GITLAB_TOKEN
  if (token) {
    headers['PRIVATE-TOKEN'] = token
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)

  try {
    const response = await fetch(treeUrl, { headers, signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new AgentverError('INTERNAL_ERROR', `GitLab tree API returned ${response.status}`)
    }

    const tree = (await response.json()) as GitLabTreeItem[]
    const files: FetchedFile[] = []

    for (const item of tree) {
      if (item.type !== 'blob') continue

      const filePath = encodeURIComponent(item.path)
      const fileUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/files/${filePath}/raw?ref=${commitSha}`

      const fileController = new AbortController()
      const fileTimeoutId = setTimeout(() => fileController.abort(), HTTP_TIMEOUT_MS)

      try {
        const fileResponse = await fetch(fileUrl, { headers, signal: fileController.signal })
        clearTimeout(fileTimeoutId)

        if (!fileResponse.ok) {
          logger.warn(`Failed to fetch GitLab file ${item.path}: ${fileResponse.status}`)
          continue
        }

        const content = await fileResponse.text()
        if (content.length > MAX_FILE_SIZE_BYTES) {
          logger.debug(`Skipping large file (${content.length} bytes): ${item.path}`)
          continue
        }

        const relativePath = path ? item.path.slice(path.length + 1) : item.path
        files.push({ path: relativePath, content, size: content.length })
      } catch (error) {
        clearTimeout(fileTimeoutId)
        logger.warn(`Failed to fetch GitLab file ${item.path}: ${String(error)}`)
      }
    }

    return files
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof AgentverError) throw error
    throw new AgentverError('INTERNAL_ERROR', `GitLab API fetch failed: ${String(error)}`)
  }
}

async function fetchViaArchive(resolved: ResolvedRef): Promise<FetchedFile[]> {
  const { source, commitSha } = resolved

  if (source.host === 'github.com') {
    return fetchGitHubArchive(source, commitSha)
  }

  if (source.host === 'gitlab.com') {
    return fetchGitLabArchive(source, commitSha)
  }

  // Generic hosts — try git archive command
  return fetchGitArchiveCommand(source, commitSha)
}

async function fetchGitHubArchive(source: GitSource, commitSha: string): Promise<FetchedFile[]> {
  const url = `https://api.github.com/repos/${source.owner}/${source.repo}/tarball/${commitSha}`
  const tempDir = join(tmpdir(), `agentver-archive-${randomUUID()}`)

  try {
    await mkdir(tempDir, { recursive: true })

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'agentver-cli',
    }

    const token = process.env.GITHUB_TOKEN
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), GIT_TIMEOUT_MS)

    const response = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new AgentverError('INTERNAL_ERROR', `GitHub tarball API returned ${response.status}`)
    }

    const tarballPath = join(tempDir, 'archive.tar.gz')
    const buffer = Buffer.from(await response.arrayBuffer())
    await writeFile(tarballPath, buffer)

    const extractDir = join(tempDir, 'extracted')
    await mkdir(extractDir, { recursive: true })

    await execFileAsync('tar', ['xzf', tarballPath, '-C', extractDir, '--strip-components=1'], {
      timeout: GIT_TIMEOUT_MS,
    })

    const readFrom = source.path ? join(extractDir, source.path) : extractDir
    return await readFilesFromDirectory(readFrom)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function fetchGitLabArchive(source: GitSource, commitSha: string): Promise<FetchedFile[]> {
  const projectId = encodeURIComponent(`${source.owner}/${source.repo}`)
  const url = `https://gitlab.com/api/v4/projects/${projectId}/repository/archive.tar.gz?sha=${commitSha}`
  const tempDir = join(tmpdir(), `agentver-archive-${randomUUID()}`)

  try {
    await mkdir(tempDir, { recursive: true })

    const headers: Record<string, string> = { 'User-Agent': 'agentver-cli' }
    const token = process.env.GITLAB_TOKEN
    if (token) {
      headers['PRIVATE-TOKEN'] = token
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), GIT_TIMEOUT_MS)

    const response = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new AgentverError('INTERNAL_ERROR', `GitLab archive API returned ${response.status}`)
    }

    const tarballPath = join(tempDir, 'archive.tar.gz')
    const buffer = Buffer.from(await response.arrayBuffer())
    await writeFile(tarballPath, buffer)

    const extractDir = join(tempDir, 'extracted')
    await mkdir(extractDir, { recursive: true })

    await execFileAsync('tar', ['xzf', tarballPath, '-C', extractDir, '--strip-components=1'], {
      timeout: GIT_TIMEOUT_MS,
    })

    const readFrom = source.path ? join(extractDir, source.path) : extractDir
    return await readFilesFromDirectory(readFrom)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function fetchGitArchiveCommand(
  source: GitSource,
  commitSha: string
): Promise<FetchedFile[]> {
  const repoUrl = buildRepoUrl(source)
  const tempDir = join(tmpdir(), `agentver-archive-${randomUUID()}`)

  try {
    await mkdir(tempDir, { recursive: true })

    const args = ['archive', `--remote=${repoUrl}`, commitSha]
    if (source.path) {
      args.push('--', source.path)
    }

    const tarOutput = await execGit(args)
    const tarPath = join(tempDir, 'archive.tar')
    await writeFile(tarPath, tarOutput)

    const extractDir = join(tempDir, 'extracted')
    await mkdir(extractDir, { recursive: true })

    await execFileAsync('tar', ['xf', tarPath, '-C', extractDir], { timeout: GIT_TIMEOUT_MS })

    const readFrom = source.path ? join(extractDir, source.path) : extractDir
    return await readFilesFromDirectory(readFrom)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function fetchViaSparseCheckout(resolved: ResolvedRef): Promise<FetchedFile[]> {
  const { source, commitSha } = resolved
  const repoUrl = buildRepoUrl(source)
  const tempDir = join(tmpdir(), `agentver-sparse-${randomUUID()}`)

  try {
    await mkdir(tempDir, { recursive: true })

    await execGit([
      'clone',
      '--no-checkout',
      '--depth',
      '1',
      '--filter=blob:none',
      repoUrl,
      tempDir,
    ])
    await execGit(['sparse-checkout', 'set', source.path || '.'], tempDir)
    await execGit(['checkout', commitSha], tempDir)

    const readFrom = source.path ? join(tempDir, source.path) : tempDir
    return await readFilesFromDirectory(readFrom)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function fetchViaClone(resolved: ResolvedRef): Promise<FetchedFile[]> {
  const { source, commitSha } = resolved
  const repoUrl = buildRepoUrl(source)
  const tempDir = join(tmpdir(), `agentver-clone-${randomUUID()}`)

  try {
    await mkdir(tempDir, { recursive: true })

    await execGit(['clone', '--depth', '1', repoUrl, tempDir])
    await execGit(['fetch', '--depth', '1', 'origin', commitSha], tempDir)
    await execGit(['checkout', commitSha], tempDir)

    const readFrom = source.path ? join(tempDir, source.path) : tempDir
    return await readFilesFromDirectory(readFrom)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function gitHubFetch(url: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'agentver-cli',
  }

  const token = process.env.GITHUB_TOKEN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)

  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'ENOENT'
  )
}

// --- GitHub API types ---

type GitHubContentItem = {
  name: string
  path: string
  sha: string
  size: number
  type: 'file' | 'dir' | 'symlink' | 'submodule'
  download_url: string | null
}

type GitHubContentFile = {
  name: string
  path: string
  sha: string
  size: number
  type: 'file'
  content: string
  encoding: string
}

// --- GitLab API types ---

type GitLabTreeItem = {
  id: string
  name: string
  type: 'tree' | 'blob'
  path: string
  mode: string
}
