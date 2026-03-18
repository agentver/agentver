import { createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'

const logger = createLogger('github-public-fetch')

type GitHubDirectoryEntry = {
  name: string
  path: string
  type: 'file' | 'dir' | 'symlink' | 'submodule'
  download_url: string | null
}

/**
 * Build the list of candidate file paths to probe when resolving a skill entry file.
 * When a subpath is provided, tries direct then skills/-prefixed locations for each format.
 * When no subpath is given, only tries root-level files (no prefix).
 */
export function buildCandidatePaths(path: string | null): string[] {
  return path
    ? [
        `${path}/SKILL.md`,
        `skills/${path}/SKILL.md`,
        `${path}/agentver.yaml`,
        `skills/${path}/agentver.yaml`,
        `${path}/skill.md`,
        `skills/${path}/skill.md`,
        `${path}/agentver.yml`,
        `skills/${path}/agentver.yml`,
      ]
    : ['SKILL.md', 'agentver.yaml', 'skill.md', 'agentver.yml']
}

/**
 * Fetch a SKILL.md from a public GitHub repo using raw.githubusercontent.com.
 * Tries the given path, then falls back to the repo root.
 */
export async function fetchSkillMdFromGitHub(
  owner: string,
  repo: string,
  path: string | null
): Promise<{ content: string; resolvedPath: string; branch: string }> {
  const candidatePaths = buildCandidatePaths(path)

  // Fast path: try raw URLs for common branch names
  for (const candidate of candidatePaths) {
    for (const branch of ['main', 'master']) {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${candidate}`
      const response = await fetch(url, {
        headers: { Accept: 'text/plain' },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.ok) {
        return { content: await response.text(), resolvedPath: candidate, branch }
      }
    }
  }

  // Fallback: GitHub Contents API resolves the actual default branch automatically,
  // which handles repos that use non-standard branch names (trunk, develop, etc.)
  for (const candidate of candidatePaths) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${candidate}`
    const apiResponse = await fetch(apiUrl, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (apiResponse.ok) {
      const data = (await apiResponse.json()) as {
        content?: string
        encoding?: string
        download_url?: string | null
      }
      if (data.content && data.encoding === 'base64') {
        const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8')
        return { content, resolvedPath: candidate, branch: 'default' }
      }
    }
  }

  throw new TRPCError({
    code: 'NOT_FOUND',
    message: `Could not find SKILL.md or agentver.yaml in ${owner}/${repo}${path ? `/${path}` : ''}. Ensure the file exists on the repository's default branch.`,
  })
}

/**
 * Fetch all files in a skill folder from a public GitHub repo, including subdirectories.
 * Recursively lists directory contents (up to 2 levels deep) and fetches each file.
 * Preserves relative paths so subdirectory files are stored correctly.
 */
export async function fetchSkillFolderFromGitHub(
  owner: string,
  repo: string,
  folderPath: string,
  branch: string
): Promise<Array<{ path: string; content: string }>> {
  const MAX_DEPTH = 2
  const files: Array<{ path: string; content: string }> = []

  async function fetchDir(dirPath: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      if (depth === 0) {
        logger.warn('Failed to list skill folder contents', {
          owner,
          repo,
          folderPath: dirPath,
          branch,
          status: response.status,
        })
      }
      return
    }

    const entries = (await response.json()) as GitHubDirectoryEntry[]

    for (const entry of entries) {
      // Compute path relative to the root skill folder
      const relativePath = entry.path.startsWith(`${folderPath}/`)
        ? entry.path.slice(folderPath.length + 1)
        : entry.name

      if (entry.type === 'file' && entry.download_url) {
        try {
          const fileResponse = await fetch(entry.download_url, {
            headers: { Accept: 'text/plain' },
            signal: AbortSignal.timeout(10_000),
          })

          if (fileResponse.ok) {
            files.push({ path: relativePath, content: await fileResponse.text() })
          }
        } catch (error) {
          logger.warn('Failed to fetch file from skill folder', {
            path: entry.path,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } else if (entry.type === 'dir') {
        await fetchDir(entry.path, depth + 1)
      }
    }
  }

  await fetchDir(folderPath, 0)
  return files
}
