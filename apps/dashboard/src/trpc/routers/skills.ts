import type { PackageStatus, Prisma } from '@agentver/database'
import { prisma } from '@agentver/database'
import { createLogger, PACKAGE_TYPES, type PackageType, parseFrontmatter } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { GitProviderConfigError, getGitProvider } from '@/lib/git'
import { fetchSkillFolderFromGitHub, fetchSkillMdFromGitHub } from '@/lib/github/public-fetch'
import {
  commitFiles,
  deleteSkillFromGitHub,
  getDefaultBranch,
  getRepoContents,
} from '@/lib/github/skills-repo'
import { getGitHubToken } from '@/lib/github/token'
import { createNotification, createNotifications } from '@/lib/notifications'
import { invalidateOnSkillWrite } from '@/lib/redis/invalidation'
import { deliverEvent } from '@/lib/webhooks/service'
import { protectedProcedure, publicProcedure, router } from '../init'

const logger = createLogger('skills-router')

/**
 * Extract compatibility agents from a package's readme frontmatter.
 */
function extractCompatibility(readme: string | null): string[] {
  if (!readme) return []
  const { rawData, hasFrontmatter } = parseFrontmatter(readme)
  if (!hasFrontmatter) return []
  const compat = rawData.compatibility
  if (!Array.isArray(compat)) return []
  return compat.filter((v): v is string => typeof v === 'string')
}

/**
 * Build a full Git repository URL from a gitUri.
 */
function buildGitRepoUrl(gitUri: string | null): string | null {
  if (!gitUri) return null
  if (gitUri.startsWith('http://') || gitUri.startsWith('https://')) return gitUri
  return `https://${gitUri}`
}

/**
 * Get the GitHub access token for a user's connected account.
 * Throws a descriptive TRPCError when no token is available.
 */
async function requireGitHubToken(userId: string): Promise<string> {
  const account = await prisma.connectedAccount.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: 'GITHUB',
      },
    },
    select: { accessToken: true },
  })

  if (!account?.accessToken) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No connected GitHub account. Please connect your GitHub account in Settings.',
    })
  }

  return account.accessToken
}

/**
 * Check whether the organisation uses Agentver's self-hosted Forgejo storage.
 */
function isAgentverProvider(org: { skillsRepoProvider?: string | null }): boolean {
  return org.skillsRepoProvider === 'agentver'
}

/**
 * Resolve the organisation and validate it has a skills repo configured.
 * Accepts either a GitHub-backed repo (owner + name) or Agentver-hosted storage.
 */
async function requireOrgWithSkillsRepo(orgId: string, userId: string) {
  const org = await prisma.organisation.findUnique({
    where: { id: orgId },
    include: {
      members: { where: { userId } },
    },
  })

  if (!org) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' })
  }

  if (org.members.length === 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' })
  }

  const hasAgentverGit = isAgentverProvider(org)
  const hasExternalRepo = !!org.skillsRepoOwner && !!org.skillsRepoName

  if (!hasAgentverGit && !hasExternalRepo) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No skills repository connected for this organisation. Connect one in Settings.',
    })
  }

  return {
    org,
    membership: org.members[0]!,
    repoOwner: org.skillsRepoOwner ?? '',
    repoName: org.skillsRepoName ?? '',
  }
}

/**
 * Increment the patch portion of a semver version string.
 * e.g. "1.2.3" -> "1.2.4", "0.0.0" -> "0.0.1"
 */
function incrementPatchVersion(version: string): string {
  const parts = version.split('.')
  if (parts.length !== 3) return '0.0.1'

  const major = Number.parseInt(parts[0]!, 10) || 0
  const minor = Number.parseInt(parts[1]!, 10) || 0
  const patch = Number.parseInt(parts[2]!.split('-')[0]!, 10) || 0

  return `${major}.${minor}.${patch + 1}`
}

type GitProvider = 'github' | 'gitlab' | 'bitbucket'

type ParsedGitUrl = {
  provider: GitProvider
  owner: string
  repo: string
  path: string | null
  ref?: string
}

/**
 * Parse a Git URL or shorthand into provider, owner, repo, and optional path/ref.
 * Accepts:
 *   - GitHub: github.com/owner/repo[/tree/branch/path] or owner/repo[/path]
 *   - GitLab: gitlab.com/owner/repo[/-/tree/branch/path] or gitlab.com/group/subgroup/repo[/-/tree/branch/path]
 *   - Bitbucket: bitbucket.org/owner/repo[/src/branch/path]
 *   - Bare owner/repo defaults to GitHub.
 */
function parseGitUrl(url: string): ParsedGitUrl {
  const cleaned = url.trim().replace(/\/$/, '')
  const withoutProtocol = cleaned.replace(/^https?:\/\//, '')

  let provider: GitProvider = 'github'
  let remainder = withoutProtocol

  if (withoutProtocol.startsWith('gitlab.com/')) {
    provider = 'gitlab'
    remainder = withoutProtocol.replace(/^gitlab\.com\//, '')
  } else if (withoutProtocol.startsWith('bitbucket.org/')) {
    provider = 'bitbucket'
    remainder = withoutProtocol.replace(/^bitbucket\.org\//, '')
  } else if (withoutProtocol.startsWith('github.com/')) {
    provider = 'github'
    remainder = withoutProtocol.replace(/^github\.com\//, '')
  }

  if (provider === 'gitlab') {
    return parseGitLabSegments(remainder)
  }

  if (provider === 'bitbucket') {
    return parseBitbucketSegments(remainder)
  }

  return parseGitHubSegments(remainder)
}

function parseGitLabSegments(remainder: string): ParsedGitUrl {
  let working = remainder
  let ref: string | undefined
  let extraPath: string | undefined

  const treeSplit = working.split('/-/tree/')
  if (treeSplit.length === 2 && treeSplit[1]) {
    working = treeSplit[0]!
    const refAndPath = treeSplit[1]
    const slashIdx = refAndPath.indexOf('/')
    if (slashIdx === -1) {
      ref = refAndPath
    } else {
      ref = refAndPath.slice(0, slashIdx)
      extraPath = refAndPath.slice(slashIdx + 1) || undefined
    }
  }

  const segments = working.split('/').filter(Boolean)
  if (segments.length < 2) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'Invalid GitLab URL. Expected format: gitlab.com/owner/repo or gitlab.com/group/subgroup/repo',
    })
  }

  const repo = segments[segments.length - 1]!
  const owner = segments.slice(0, segments.length - 1).join('/')

  return { provider: 'gitlab', owner, repo, path: extraPath ?? null, ref }
}

function parseBitbucketSegments(remainder: string): ParsedGitUrl {
  const srcMatch = remainder.match(/^([^/]+\/[^/]+)\/src\/([^/]+)(?:\/(.+))?$/)
  if (srcMatch) {
    const [, ownerRepo, matchedRef, pathAfterRef] = srcMatch
    const segments = ownerRepo!.split('/').filter(Boolean)
    return {
      provider: 'bitbucket',
      owner: segments[0]!,
      repo: segments[1]!,
      path: pathAfterRef ?? null,
      ref: matchedRef,
    }
  }

  const segments = remainder.split('/').filter(Boolean)
  if (segments.length < 2) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Invalid Bitbucket URL. Expected format: bitbucket.org/owner/repo',
    })
  }

  return {
    provider: 'bitbucket',
    owner: segments[0]!,
    repo: segments[1]!,
    path: segments.length > 2 ? segments.slice(2).join('/') : null,
  }
}

function parseGitHubSegments(remainder: string): ParsedGitUrl {
  let working = remainder
  let ref: string | undefined

  const treeMatch = working.match(/^(.+?)\/tree\/([^/]+)(?:\/(.+))?$/)
  if (treeMatch) {
    working = treeMatch[1]!
    ref = treeMatch[2]
    if (treeMatch[3]) {
      working = `${working}/${treeMatch[3]}`
    }
  }

  const segments = working.split('/').filter(Boolean)
  if (segments.length < 2) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'Invalid repository URL. Expected format: owner/repo, github.com/..., gitlab.com/..., or bitbucket.org/...',
    })
  }

  return {
    provider: 'github',
    owner: segments[0]!,
    repo: segments[1]!,
    path: segments.length > 2 ? segments.slice(2).join('/') : null,
    ref,
  }
}

// ---------------------------------------------------------------------------
// GitLab: public fetch helpers (no auth required)
// ---------------------------------------------------------------------------

type GitLabTreeEntry = {
  id: string
  name: string
  type: 'tree' | 'blob'
  path: string
  mode: string
}

/**
 * Build the encoded GitLab project ID from owner/repo (e.g. "group/subgroup/repo" -> "group%2Fsubgroup%2Frepo").
 */
function gitlabProjectId(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`)
}

/**
 * Fetch a raw file from a public GitLab repo.
 * Returns null on 404.
 */
async function gitlabFetchRaw(
  projectId: string,
  filePath: string,
  ref: string
): Promise<string | null> {
  const encodedPath = encodeURIComponent(filePath)
  const url = `https://gitlab.com/api/v4/projects/${projectId}/repository/files/${encodedPath}/raw?ref=${ref}`

  const response = await fetch(url, {
    headers: { Accept: 'text/plain' },
    signal: AbortSignal.timeout(10_000),
  })

  if (response.status === 404) return null
  if (!response.ok) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `GitLab API error fetching file: ${response.status}`,
    })
  }

  return response.text()
}

/**
 * Fetch a SKILL.md from a public GitLab repo.
 * Tries candidate paths on main, then master.
 */
async function fetchSkillMdFromGitLab(
  owner: string,
  repo: string,
  path: string | null,
  ref?: string
): Promise<{ content: string; resolvedPath: string; branch: string }> {
  const projectId = gitlabProjectId(owner, repo)
  const candidatePaths = path
    ? [
        `${path}/SKILL.md`,
        `skills/${path}/SKILL.md`,
        `${path}/agentver.yaml`,
        `skills/${path}/agentver.yaml`,
        'SKILL.md',
      ]
    : ['SKILL.md', 'agentver.yaml']

  const branches = ref ? [ref] : ['main', 'master']

  for (const branch of branches) {
    for (const candidate of candidatePaths) {
      const content = await gitlabFetchRaw(projectId, candidate, branch)
      if (content !== null) {
        return { content, resolvedPath: candidate, branch }
      }
    }
  }

  throw new TRPCError({
    code: 'NOT_FOUND',
    message: `Could not find SKILL.md or agentver.yaml in gitlab.com/${owner}/${repo}${path ? `/${path}` : ''}. Ensure the file exists on the main or master branch.`,
  })
}

/**
 * Fetch all files in a skill folder from a public GitLab repo, including subdirectories.
 * Uses the recursive tree API to get the full directory structure in one call.
 */
async function fetchSkillFolderFromGitLab(
  owner: string,
  repo: string,
  folderPath: string,
  branch: string
): Promise<Array<{ path: string; content: string }>> {
  const projectId = gitlabProjectId(owner, repo)
  const encodedFolder = encodeURIComponent(folderPath)
  const treeUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/tree?path=${encodedFolder}&ref=${branch}&per_page=100&recursive=true`

  const response = await fetch(treeUrl, {
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    logger.warn('Failed to list GitLab skill folder', {
      owner,
      repo,
      folderPath,
      branch,
      status: response.status,
    })
    return []
  }

  const entries = (await response.json()) as GitLabTreeEntry[]
  const files: Array<{ path: string; content: string }> = []

  for (const entry of entries) {
    if (entry.type !== 'blob') continue

    // Compute path relative to the root skill folder
    const relativePath = entry.path.startsWith(`${folderPath}/`)
      ? entry.path.slice(folderPath.length + 1)
      : entry.name

    try {
      const content = await gitlabFetchRaw(projectId, entry.path, branch)
      if (content !== null) {
        files.push({ path: relativePath, content })
      }
    } catch (error) {
      logger.warn('Failed to fetch file from GitLab skill folder', {
        path: entry.path,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return files
}

// ---------------------------------------------------------------------------
// Bitbucket: public fetch helpers (no auth required)
// ---------------------------------------------------------------------------

/**
 * Fetch a raw file from a public Bitbucket repo.
 * Returns null on 404.
 */
async function bitbucketFetchRaw(
  owner: string,
  repo: string,
  filePath: string,
  ref: string
): Promise<string | null> {
  const url = `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/src/${ref}/${filePath}`

  const response = await fetch(url, {
    headers: { Accept: 'text/plain' },
    signal: AbortSignal.timeout(10_000),
  })

  if (response.status === 404) return null
  if (!response.ok) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Bitbucket API error fetching file: ${response.status}`,
    })
  }

  return response.text()
}

type BitbucketSrcEntry = {
  path: string
  type: 'commit_file' | 'commit_directory'
  size?: number
}

type BitbucketSrcResponse = {
  values: BitbucketSrcEntry[]
  next?: string
}

/**
 * Fetch a SKILL.md from a public Bitbucket repo.
 * Tries candidate paths on main, then master.
 */
async function fetchSkillMdFromBitbucket(
  owner: string,
  repo: string,
  path: string | null,
  ref?: string
): Promise<{ content: string; resolvedPath: string; branch: string }> {
  const candidatePaths = path
    ? [
        `${path}/SKILL.md`,
        `skills/${path}/SKILL.md`,
        `${path}/agentver.yaml`,
        `skills/${path}/agentver.yaml`,
        'SKILL.md',
      ]
    : ['SKILL.md', 'agentver.yaml']

  const branches = ref ? [ref] : ['main', 'master']

  for (const branch of branches) {
    for (const candidate of candidatePaths) {
      const content = await bitbucketFetchRaw(owner, repo, candidate, branch)
      if (content !== null) {
        return { content, resolvedPath: candidate, branch }
      }
    }
  }

  throw new TRPCError({
    code: 'NOT_FOUND',
    message: `Could not find SKILL.md or agentver.yaml in bitbucket.org/${owner}/${repo}${path ? `/${path}` : ''}. Ensure the file exists on the main or master branch.`,
  })
}

/**
 * Fetch all files in a skill folder from a public Bitbucket repo, including subdirectories.
 * Recursively lists directory contents (up to 2 levels deep).
 */
async function fetchSkillFolderFromBitbucket(
  owner: string,
  repo: string,
  folderPath: string,
  branch: string
): Promise<Array<{ path: string; content: string }>> {
  const MAX_DEPTH = 2
  const files: Array<{ path: string; content: string }> = []

  async function fetchDir(dirPath: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return

    const listUrl = `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/src/${branch}/${dirPath}?pagelen=100`
    const response = await fetch(listUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      if (depth === 0) {
        logger.warn('Failed to list Bitbucket skill folder', {
          owner,
          repo,
          folderPath: dirPath,
          branch,
          status: response.status,
        })
      }
      return
    }

    const data = (await response.json()) as BitbucketSrcResponse

    for (const entry of data.values) {
      // Compute path relative to the root skill folder
      const relativePath = entry.path.startsWith(`${folderPath}/`)
        ? entry.path.slice(folderPath.length + 1)
        : (entry.path.split('/').pop() ?? entry.path)

      if (entry.type === 'commit_file') {
        try {
          const content = await bitbucketFetchRaw(owner, repo, entry.path, branch)
          if (content !== null) {
            files.push({ path: relativePath, content })
          }
        } catch (error) {
          logger.warn('Failed to fetch file from Bitbucket skill folder', {
            path: entry.path,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } else if (entry.type === 'commit_directory') {
        await fetchDir(entry.path, depth + 1)
      }
    }
  }

  await fetchDir(folderPath, 0)
  return files
}

// ---------------------------------------------------------------------------
// Provider display label helper
// ---------------------------------------------------------------------------

function providerDomain(provider: GitProvider): string {
  switch (provider) {
    case 'github':
      return 'github.com'
    case 'gitlab':
      return 'gitlab.com'
    case 'bitbucket':
      return 'bitbucket.org'
  }
}

export const skillsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        organisationId: z.string().optional(),
        type: z
          .enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT', 'AGENT', 'COMMAND'])
          .optional(),
        status: z.enum(['ACTIVE', 'ARCHIVED', 'DEPRECATED']).optional(),
        search: z.string().optional(),
        compatibility: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const archivedStatus: PackageStatus = 'ARCHIVED'
      const statusFilter: Prisma.PackageWhereInput = input.status
        ? { status: input.status as PackageStatus }
        : {
            // By default, exclude archived packages unless the user is a member of the org
            OR: [
              { status: { not: archivedStatus } },
              {
                status: archivedStatus,
                organisation: {
                  members: { some: { userId: ctx.user.id } },
                },
              },
            ],
          }

      const where = {
        ...(input.organisationId && { organisationId: input.organisationId }),
        ...(input.type && { type: input.type }),
        ...(input.search && {
          OR: [
            { name: { contains: input.search, mode: 'insensitive' as const } },
            { description: { contains: input.search, mode: 'insensitive' as const } },
          ],
        }),
        ...(input.compatibility && {
          compatibilityAgents: {
            hasSome: input.compatibility.split(',').map((s) => s.trim().toLowerCase()),
          },
        }),
        AND: [
          statusFilter,
          {
            OR: [
              { visibility: 'PUBLIC' as const },
              {
                organisation: {
                  members: { some: { userId: ctx.user.id } },
                },
              },
              {
                visibility: 'TEAM' as const,
                team: {
                  members: { some: { userId: ctx.user.id } },
                },
              },
            ],
          },
        ],
      }

      const fetchLimit = input.limit + 1

      const packages = await prisma.package.findMany({
        where,
        take: fetchLimit,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: { updatedAt: 'desc' },
        include: {
          organisation: { select: { slug: true, name: true } },
          author: { select: { name: true, image: true } },
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { version: true, gitRef: true },
          },
          _count: { select: { installationReports: true } },
        },
      })

      let filteredPackages = packages

      let nextCursor: string | undefined
      if (filteredPackages.length > input.limit) {
        filteredPackages = filteredPackages.slice(0, input.limit + 1)
        const next = filteredPackages.pop()
        nextCursor = next?.id
      }

      return { packages: filteredPackages, nextCursor }
    }),

  /**
   * Import a skill from a public GitHub, GitLab, or Bitbucket repository URL.
   * Fetches the SKILL.md, parses frontmatter, and creates a Package record.
   */
  importFromUrl: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        url: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify org membership
      const org = await prisma.organisation.findUnique({
        where: { id: input.organisationId },
        include: {
          members: { where: { userId: ctx.user.id } },
        },
      })

      if (!org) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' })
      }

      if (org.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' })
      }

      // Parse the repository URL (supports GitHub, GitLab, Bitbucket)
      const { provider, owner, repo, path, ref } = parseGitUrl(input.url)
      const domain = providerDomain(provider)

      // Fetch the SKILL.md content from the appropriate provider
      let content: string
      let resolvedPath: string
      let branch: string

      switch (provider) {
        case 'gitlab': {
          const result = await fetchSkillMdFromGitLab(owner, repo, path, ref)
          content = result.content
          resolvedPath = result.resolvedPath
          branch = result.branch
          break
        }
        case 'bitbucket': {
          const result = await fetchSkillMdFromBitbucket(owner, repo, path, ref)
          content = result.content
          resolvedPath = result.resolvedPath
          branch = result.branch
          break
        }
        default: {
          const result = await fetchSkillMdFromGitHub(owner, repo, path)
          content = result.content
          resolvedPath = result.resolvedPath
          branch = result.branch
        }
      }

      // Parse frontmatter to extract metadata
      const { rawData } = parseFrontmatter(content)

      const name =
        (typeof rawData.name === 'string' && rawData.name) || (path ? path.split('/').pop()! : repo)

      // Normalise name to kebab-case
      const normalisedName = name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      const description = typeof rawData.description === 'string' ? rawData.description : undefined

      const rawType = typeof rawData.type === 'string' ? rawData.type.toUpperCase() : 'SKILL'
      const VALID_TYPES = new Set<string>(PACKAGE_TYPES)
      const type = VALID_TYPES.has(rawType) ? (rawType as PackageType) : 'SKILL'

      const tags = Array.isArray(rawData.tags)
        ? rawData.tags.filter((t): t is string => typeof t === 'string')
        : []

      // Check for name collision within the org
      const existing = await prisma.package.findFirst({
        where: { name: normalisedName, organisationId: input.organisationId },
      })

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A package named "${normalisedName}" already exists in this organisation.`,
        })
      }

      // Fetch all files from the skill folder (not just SKILL.md)
      const folderPath = resolvedPath.includes('/')
        ? resolvedPath.slice(0, resolvedPath.lastIndexOf('/'))
        : null

      let allFiles: Array<{ path: string; content: string }> = []

      if (folderPath) {
        switch (provider) {
          case 'gitlab':
            allFiles = await fetchSkillFolderFromGitLab(owner, repo, folderPath, branch)
            break
          case 'bitbucket':
            allFiles = await fetchSkillFolderFromBitbucket(owner, repo, folderPath, branch)
            break
          default:
            allFiles = await fetchSkillFolderFromGitHub(owner, repo, folderPath, branch)
        }
      }

      // If folder listing failed or returned nothing, fall back to the single SKILL.md
      if (allFiles.length === 0) {
        const fileName = resolvedPath.includes('/')
          ? resolvedPath.slice(resolvedPath.lastIndexOf('/') + 1)
          : resolvedPath
        allFiles = [{ path: fileName, content }]
      }

      const slug = `${org.slug}/${normalisedName}`
      const gitPath = `skills/${normalisedName}`
      const sourceLabel = `${domain}/${owner}/${repo}`
      const commitMessage = `Import ${normalisedName} from ${sourceLabel}`
      let commitSha: string | undefined
      let commitUrl: string | null = null

      // Commit all files to the org's skills storage
      const hasAgentverGit = isAgentverProvider(org)
      const hasExternalRepo = !!org.skillsRepoOwner && !!org.skillsRepoName

      if (hasAgentverGit) {
        try {
          const result = await getGitProvider().createSkill(
            org.slug,
            normalisedName,
            allFiles.map((f) => ({ path: f.path, content: f.content })),
            commitMessage
          )
          commitSha = result.commitSha
        } catch (error) {
          logger.error('Failed to commit imported files to Agentver storage', {
            name: normalisedName,
            error: error instanceof Error ? error.message : String(error),
          })
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to store skill files: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      } else if (hasExternalRepo) {
        try {
          const token = await requireGitHubToken(ctx.user.id)
          const targetBranch = await getDefaultBranch(
            org.skillsRepoOwner!,
            org.skillsRepoName!,
            token
          ).catch(() => 'main')

          const commitResult = await commitFiles(
            org.skillsRepoOwner!,
            org.skillsRepoName!,
            allFiles.map((f) => ({
              path: `skills/${normalisedName}/${f.path}`,
              content: f.content,
            })),
            commitMessage,
            targetBranch,
            token
          )
          commitSha = commitResult.sha
          commitUrl = `https://github.com/${org.skillsRepoOwner}/${org.skillsRepoName}/commit/${commitSha}`
        } catch (error) {
          logger.error('Failed to commit imported files to GitHub skills repo', {
            name: normalisedName,
            error: error instanceof Error ? error.message : String(error),
          })
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to store skill files in GitHub: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      }

      const gitUri = hasAgentverGit
        ? `agentver://${org.slug}`
        : hasExternalRepo
          ? `github.com/${org.skillsRepoOwner}/${org.skillsRepoName}`
          : sourceLabel

      const pkg = await prisma.package.create({
        data: {
          name: normalisedName,
          slug,
          description,
          type,
          visibility: 'PRIVATE',
          tags,
          readme: content,
          compatibilityAgents: extractCompatibility(content),
          organisationId: input.organisationId,
          authorId: ctx.user.id,
          gitUri,
          gitPath,
          gitDefaultRef: branch,
        },
        include: {
          organisation: { select: { slug: true, name: true } },
        },
      })

      // Create an initial version
      await prisma.packageVersion.create({
        data: {
          packageId: pkg.id,
          version: '1.0.0',
          changelog: `Imported from ${sourceLabel}`,
          gitRef: branch,
          ...(commitSha && { gitCommitSha: commitSha }),
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_CREATED',
        resource: 'Package',
        resourceId: pkg.id,
        metadata: {
          name: normalisedName,
          type,
          organisationId: input.organisationId,
          importedFrom: sourceLabel,
          fileCount: allFiles.length,
        },
      })

      void deliverEvent(
        input.organisationId,
        'skill.created',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        { skill: { name: normalisedName, slug } }
      )

      logger.info('Skill imported from URL', {
        packageId: pkg.id,
        name: normalisedName,
        source: sourceLabel,
        fileCount: allFiles.length,
        commitSha,
      })

      invalidateOnSkillWrite(org.slug, normalisedName).catch(() => {})

      return { ...pkg, commitSha, commitUrl }
    }),

  getBySlug: publicProcedure
    .input(z.object({ org: z.string(), name: z.string() }))
    .query(async ({ input }) => {
      const pkg = await prisma.package.findFirst({
        where: {
          name: input.name,
          organisation: { slug: input.org },
        },
        include: {
          organisation: {
            select: {
              slug: true,
              name: true,
              id: true,
              skillsRepoOwner: true,
              skillsRepoName: true,
              skillsRepoUrl: true,
              skillsRepoProvider: true,
            },
          },
          author: { select: { name: true, image: true } },
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              id: true,
              version: true,
              changelog: true,
              status: true,
              createdAt: true,
              gitRef: true,
              gitCommitSha: true,
            },
          },
          forkedFrom: {
            select: {
              name: true,
              organisation: { select: { slug: true } },
            },
          },
          _count: { select: { installationReports: true, forks: true } },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      let resolvedReadme = pkg.readme

      if (!resolvedReadme && isAgentverProvider(pkg.organisation)) {
        try {
          const content = await getGitProvider().getSkillFile(
            pkg.organisation.slug,
            pkg.name,
            'SKILL.md',
            pkg.gitDefaultRef || undefined
          )
          if (content) {
            resolvedReadme = content
          }
        } catch (error) {
          logger.warn('Failed to resolve skill content from Forgejo for public view', {
            org: pkg.organisation.slug,
            name: pkg.name,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      return {
        ...pkg,
        readme: resolvedReadme,
        gitRepoUrl: buildGitRepoUrl(pkg.gitUri),
      }
    }),

  /**
   * Fetch the current content of a skill from the org's Git repo.
   * Tries Agentver Forgejo first (if provider is 'agentver'), then GitHub,
   * then falls back to the database readme.
   */
  getSkillContent: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        include: {
          organisation: {
            include: { members: { where: { userId: ctx.user.id } } },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      if (pkg.organisation.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' })
      }

      const gitPath = pkg.gitPath || `skills/${pkg.name}/SKILL.md`

      // Agentver-hosted Forgejo path
      if (isAgentverProvider(pkg.organisation)) {
        try {
          const content = await getGitProvider().getSkillFile(
            pkg.organisation.slug,
            pkg.name,
            'SKILL.md',
            pkg.gitDefaultRef || undefined
          )

          if (content) {
            return {
              content,
              source: 'git' as const,
              gitPath,
              sha: null,
            }
          }
        } catch (error) {
          if (error instanceof GitProviderConfigError) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
          }
          logger.warn('Failed to fetch skill content from Forgejo, falling back to database', {
            packageId: input.packageId,
            error: error instanceof Error ? error.message : String(error),
          })
        }

        return {
          content: pkg.readme ?? '',
          source: 'database' as const,
          gitPath,
          sha: null,
        }
      }

      // GitHub-backed path
      const repoOwner = pkg.organisation.skillsRepoOwner
      const repoName = pkg.organisation.skillsRepoName

      if (!repoOwner || !repoName) {
        return {
          content: pkg.readme ?? '',
          source: 'database' as const,
          gitPath: null,
          sha: null,
        }
      }

      const token = await requireGitHubToken(ctx.user.id)

      try {
        const result = await getRepoContents(repoOwner, repoName, gitPath, pkg.gitDefaultRef, token)

        if (result.type !== 'file' || !result.content) {
          return {
            content: pkg.readme ?? '',
            source: 'database' as const,
            gitPath,
            sha: null,
          }
        }

        return {
          content: result.content,
          source: 'git' as const,
          gitPath: result.path,
          sha: result.sha,
        }
      } catch (error) {
        logger.warn('Failed to fetch skill content from Git, falling back to database', {
          packageId: input.packageId,
          gitPath,
          error: error instanceof Error ? error.message : String(error),
        })

        return {
          content: pkg.readme ?? '',
          source: 'database' as const,
          gitPath,
          sha: null,
        }
      }
    }),

  /**
   * Save skill content by committing to the org's Git repository.
   * Creates a new PackageVersion record with the commit SHA.
   * Routes to Agentver Forgejo or GitHub based on the org's provider.
   */
  saveSkillContent: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        content: z.string().min(1).max(5_242_880, 'Content must be under 5MB'),
        commitMessage: z.string().min(1).max(500).optional(),
        description: z.string().max(500).optional(),
        tags: z.array(z.string()).max(20).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        include: {
          organisation: {
            include: { members: { where: { userId: ctx.user.id } } },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      const membership = pkg.organisation.members[0]
      const isAuthor = pkg.authorId === ctx.user.id
      const isAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'

      if (!isAuthor && !isAdminOrOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the package author or organisation admins can update packages',
        })
      }

      const { org, repoOwner, repoName } = await requireOrgWithSkillsRepo(
        pkg.organisationId,
        ctx.user.id
      )

      const gitPath = pkg.gitPath || `skills/${pkg.name}/SKILL.md`
      const message = input.commitMessage ?? `Update ${pkg.name} via Agentver`

      let commitSha: string
      let branch: string
      let commitUrl: string | null

      if (isAgentverProvider(org)) {
        // Agentver Forgejo path
        branch = 'main'
        try {
          const result = await getGitProvider().updateSkillFile(
            org.slug,
            pkg.name,
            'SKILL.md',
            input.content,
            message
          )
          commitSha = result.commitSha
        } catch (error) {
          if (error instanceof GitProviderConfigError) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
          }
          logger.error('Failed to save skill content to Forgejo', {
            packageId: input.packageId,
            error: error instanceof Error ? error.message : String(error),
          })
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to commit skill content to Agentver storage',
          })
        }
        commitUrl = null
      } else {
        // GitHub-backed path
        const token = await requireGitHubToken(ctx.user.id)

        try {
          branch = await getDefaultBranch(repoOwner, repoName, token)
        } catch {
          branch = pkg.gitDefaultRef
        }

        const commitResult = await commitFiles(
          repoOwner,
          repoName,
          [{ path: gitPath, content: input.content }],
          message,
          branch,
          token
        )
        commitSha = commitResult.sha
        commitUrl = `https://github.com/${repoOwner}/${repoName}/commit/${commitSha}`
      }

      // Update Package record — sync readme and metadata
      const gitUri = isAgentverProvider(org)
        ? `agentver://${org.slug}`
        : `github.com/${repoOwner}/${repoName}`

      await prisma.package.update({
        where: { id: input.packageId },
        data: {
          readme: input.content,
          compatibilityAgents: extractCompatibility(input.content),
          gitUri,
          gitPath,
          gitDefaultRef: branch,
          ...(input.description !== undefined && { description: input.description }),
          ...(input.tags && { tags: input.tags }),
        },
      })

      // Auto-increment the patch version
      const latestVersion = await prisma.packageVersion.findFirst({
        where: { packageId: input.packageId },
        orderBy: { createdAt: 'desc' },
        select: { version: true },
      })

      const nextVersion = incrementPatchVersion(latestVersion?.version ?? '0.0.0')

      // Create a new PackageVersion linked to the commit
      const version = await prisma.packageVersion.create({
        data: {
          packageId: input.packageId,
          version: nextVersion,
          changelog: message,
          gitRef: branch,
          gitCommitSha: commitSha,
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_UPDATED',
        resource: 'Package',
        resourceId: input.packageId,
        metadata: {
          commitSha,
          branch,
          version: nextVersion,
        },
      })

      // Notify other org members
      const orgMembers = await prisma.organisationMember.findMany({
        where: {
          organisationId: pkg.organisationId,
          userId: { not: ctx.user.id },
        },
        select: { userId: true },
      })

      if (orgMembers.length > 0) {
        const actorName = ctx.user.name ?? ctx.user.email
        const pkgDisplayName = `${pkg.organisation.slug}/${pkg.name}`
        createNotifications(
          prisma,
          orgMembers.map((member) => ({
            userId: member.userId,
            type: 'PACKAGE_UPDATED' as const,
            title: `${actorName} updated ${pkgDisplayName}`,
            body: message,
            resourceId: pkg.id,
            resourceType: 'package',
            actorId: ctx.user.id,
          }))
        )
      }

      void deliverEvent(
        pkg.organisationId,
        'skill.updated',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        { skill: { name: pkg.name, slug: pkg.slug } }
      )
      logger.info('Skill content saved via Git commit', {
        packageId: input.packageId,
        commitSha,
        branch,
        version: nextVersion,
      })

      invalidateOnSkillWrite(pkg.organisation.slug, pkg.name).catch(() => {})

      return {
        commitSha,
        branch,
        version: version.version,
        versionId: version.id,
        commitUrl,
      }
    }),

  /**
   * Create a new skill via the web UI.
   * Commits the SKILL.md to Git and creates Package + PackageVersion records.
   * Routes to Agentver Forgejo or GitHub based on the org's provider.
   */
  createViaWeb: protectedProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[a-z0-9-]+$/, 'Name must be lowercase alphanumeric with hyphens'),
        description: z.string().max(500).optional(),
        type: z.enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT']).default('SKILL'),
        visibility: z.enum(['PUBLIC', 'PRIVATE', 'TEAM']).default('PRIVATE'),
        tags: z.array(z.string()).max(20).default([]),
        organisationId: z.string(),
        content: z.string().min(1).max(5_242_880, 'Content must be under 5MB'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { org, repoOwner, repoName } = await requireOrgWithSkillsRepo(
        input.organisationId,
        ctx.user.id
      )

      const slug = `${org.slug}/${input.name}`
      const gitPath = `skills/${input.name}/SKILL.md`
      const commitMessage = `Create ${input.name} via Agentver`

      let commitSha: string
      let branch: string
      let commitUrl: string | null
      let gitUri: string

      if (isAgentverProvider(org)) {
        // Agentver Forgejo path
        branch = 'main'
        try {
          const result = await getGitProvider().createSkill(
            org.slug,
            input.name,
            [{ path: 'SKILL.md', content: input.content }],
            commitMessage
          )
          commitSha = result.commitSha
        } catch (error) {
          if (error instanceof GitProviderConfigError) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
          }
          logger.error('Failed to create skill in Forgejo', {
            name: input.name,
            error: error instanceof Error ? error.message : String(error),
          })
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create skill in Agentver storage',
          })
        }
        gitUri = `agentver://${org.slug}`
        commitUrl = null
      } else {
        // GitHub-backed path
        const token = await requireGitHubToken(ctx.user.id)

        try {
          branch = await getDefaultBranch(repoOwner, repoName, token)
        } catch {
          branch = 'main'
        }

        const commitResult = await commitFiles(
          repoOwner,
          repoName,
          [{ path: gitPath, content: input.content }],
          commitMessage,
          branch,
          token
        )
        commitSha = commitResult.sha
        gitUri = `github.com/${repoOwner}/${repoName}`
        commitUrl = `https://github.com/${repoOwner}/${repoName}/commit/${commitSha}`
      }

      // Create the Package record
      const pkg = await prisma.package.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          type: input.type,
          visibility: input.visibility,
          tags: input.tags,
          readme: input.content,
          compatibilityAgents: extractCompatibility(input.content),
          organisationId: input.organisationId,
          authorId: ctx.user.id,
          gitUri,
          gitPath,
          gitDefaultRef: branch,
        },
      })

      // Create the initial PackageVersion
      await prisma.packageVersion.create({
        data: {
          packageId: pkg.id,
          version: '1.0.0',
          changelog: commitMessage,
          gitRef: branch,
          gitCommitSha: commitSha,
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_CREATED',
        resource: 'Package',
        resourceId: pkg.id,
        metadata: {
          name: input.name,
          type: input.type,
          organisationId: input.organisationId,
          commitSha,
          branch,
        },
      })

      void deliverEvent(
        input.organisationId,
        'skill.created',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        { skill: { name: input.name, slug } }
      )
      logger.info('Skill created via web editor', {
        packageId: pkg.id,
        name: input.name,
        commitSha,
        branch,
      })

      invalidateOnSkillWrite(org.slug, input.name).catch(() => {})

      return {
        ...pkg,
        commitSha,
        commitUrl,
      }
    }),

  installationStats: protectedProcedure
    .input(z.object({ packageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        select: {
          organisation: {
            select: {
              members: { where: { userId: ctx.user.id }, select: { id: true } },
            },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      if (pkg.organisation.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' })
      }

      const reports = await prisma.installationReport.findMany({
        where: { packageId: input.packageId },
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
          version: { select: { version: true, gitRef: true } },
        },
        orderBy: { lastSeenAt: 'desc' },
      })

      const uniqueUsers = new Set(reports.map((r) => r.userId))
      const modifiedCount = reports.filter((r) => r.modified).length

      return {
        totalInstallations: reports.length,
        uniqueMembers: uniqueUsers.size,
        modifiedCount,
        reports,
      }
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[a-z0-9-]+$/),
        description: z.string().max(500).optional(),
        type: z.enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT']).default('SKILL'),
        visibility: z.enum(['PUBLIC', 'PRIVATE', 'TEAM']).default('PRIVATE'),
        tags: z.array(z.string()).max(20).default([]),
        organisationId: z.string(),
        gitUri: z.string().optional(),
        gitPath: z.string().optional(),
        gitDefaultRef: z.string().default('main'),
        content: z.string().max(5_242_880, 'Content must be under 5MB').optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const org = await prisma.organisation.findUnique({
        where: { id: input.organisationId },
        include: {
          members: { where: { userId: ctx.user.id } },
        },
      })

      if (!org || org.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' })
      }

      const slug = `${org.slug}/${input.name}`

      const pkg = await prisma.package.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          type: input.type,
          visibility: input.visibility,
          tags: input.tags,
          readme: input.content,
          compatibilityAgents: extractCompatibility(input.content ?? null),
          organisationId: input.organisationId,
          authorId: ctx.user.id,
          gitUri: input.gitUri ?? org.skillsRepoUrl,
          gitPath: input.gitPath,
          gitDefaultRef: input.gitDefaultRef,
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_CREATED',
        resource: 'Package',
        resourceId: pkg.id,
        metadata: { name: input.name, type: input.type, organisationId: input.organisationId },
      })

      void deliverEvent(
        input.organisationId,
        'skill.created',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        { skill: { name: input.name, slug } }
      )

      invalidateOnSkillWrite(org.slug, input.name).catch(() => {})

      return pkg
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        description: z.string().max(500).optional(),
        visibility: z.enum(['PUBLIC', 'PRIVATE', 'TEAM']).optional(),
        tags: z.array(z.string()).max(20).optional(),
        gitUri: z.string().optional(),
        gitPath: z.string().optional(),
        gitDefaultRef: z.string().optional(),
        content: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.id },
        include: {
          organisation: {
            include: {
              members: {
                where: { userId: ctx.user.id },
              },
            },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      const membership = pkg.organisation.members[0]
      const isAuthor = pkg.authorId === ctx.user.id
      const isAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'

      if (!isAuthor && !isAdminOrOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the package author or organisation admins can update packages',
        })
      }

      const updated = await prisma.package.update({
        where: { id: input.id },
        data: {
          ...(input.description !== undefined && { description: input.description }),
          ...(input.visibility && { visibility: input.visibility }),
          ...(input.tags && { tags: input.tags }),
          ...(input.gitUri !== undefined && { gitUri: input.gitUri }),
          ...(input.gitPath !== undefined && { gitPath: input.gitPath }),
          ...(input.gitDefaultRef && { gitDefaultRef: input.gitDefaultRef }),
          ...(input.content && {
            readme: input.content,
            compatibilityAgents: extractCompatibility(input.content),
          }),
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_UPDATED',
        resource: 'Package',
        resourceId: input.id,
      })

      // Notify other org members when a package is updated
      const orgMembers = await prisma.organisationMember.findMany({
        where: {
          organisationId: pkg.organisationId,
          userId: { not: ctx.user.id },
        },
        select: { userId: true },
      })

      if (orgMembers.length > 0) {
        const actorName = ctx.user.name ?? ctx.user.email
        const pkgDisplayName = `${pkg.organisation.slug}/${pkg.name}`
        createNotifications(
          prisma,
          orgMembers.map((member) => ({
            userId: member.userId,
            type: 'PACKAGE_UPDATED' as const,
            title: `${actorName} updated ${pkgDisplayName}`,
            body: input.description ? `Description changed` : 'Package content updated',
            resourceId: pkg.id,
            resourceType: 'package',
            actorId: ctx.user.id,
          }))
        )
      }

      invalidateOnSkillWrite(pkg.organisation.slug, pkg.name).catch(() => {})

      return updated
    }),

  archive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.id },
        include: {
          organisation: {
            include: {
              members: { where: { userId: ctx.user.id } },
            },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      const membership = pkg.organisation.members[0]
      const isAuthor = pkg.authorId === ctx.user.id
      const isAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'

      if (!isAuthor && !isAdminOrOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the package author or organisation admins can archive packages',
        })
      }

      const updated = await prisma.package.update({
        where: { id: input.id },
        data: { status: 'ARCHIVED' },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_ARCHIVED',
        resource: 'Package',
        resourceId: input.id,
        metadata: { name: pkg.name, slug: pkg.slug },
      })

      return updated
    }),

  deprecate: protectedProcedure
    .input(z.object({ id: z.string(), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.id },
        include: {
          organisation: {
            include: {
              members: { where: { userId: ctx.user.id } },
            },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      const membership = pkg.organisation.members[0]
      const isAuthor = pkg.authorId === ctx.user.id
      const isAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'

      if (!isAuthor && !isAdminOrOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the package author or organisation admins can deprecate packages',
        })
      }

      const updated = await prisma.package.update({
        where: { id: input.id },
        data: {
          status: 'DEPRECATED',
          deprecationNote: input.note ?? null,
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_DEPRECATED',
        resource: 'Package',
        resourceId: input.id,
        metadata: { name: pkg.name, slug: pkg.slug, deprecationNote: input.note },
      })

      return updated
    }),

  activate: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.id },
        include: {
          organisation: {
            include: {
              members: { where: { userId: ctx.user.id } },
            },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      const membership = pkg.organisation.members[0]
      const isAuthor = pkg.authorId === ctx.user.id
      const isAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'

      if (!isAuthor && !isAdminOrOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the package author or organisation admins can restore packages',
        })
      }

      const updated = await prisma.package.update({
        where: { id: input.id },
        data: {
          status: 'ACTIVE',
          deprecationNote: null,
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_ACTIVATED',
        resource: 'Package',
        resourceId: input.id,
        metadata: { name: pkg.name, slug: pkg.slug },
      })

      return updated
    }),

  fork: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        organisationId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const sourcePkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        include: {
          organisation: {
            include: { members: { where: { userId: ctx.user.id } } },
          },
        },
      })

      if (!sourcePkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Source package not found' })
      }

      const isPublic = sourcePkg.visibility === 'PUBLIC'
      const isMemberOfSource = sourcePkg.organisation.members.length > 0
      if (!isPublic && !isMemberOfSource) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to source package' })
      }

      const targetOrg = await prisma.organisation.findUnique({
        where: { id: input.organisationId },
        include: {
          members: { where: { userId: ctx.user.id } },
        },
      })

      if (!targetOrg || targetOrg.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of target organisation' })
      }

      const existingName = await prisma.package.findFirst({
        where: { name: sourcePkg.name, organisationId: targetOrg.id },
      })
      const forkName = existingName ? `${sourcePkg.name}-fork` : sourcePkg.name
      const forkSlug = `${targetOrg.slug}/${forkName}`

      const forkedPkg = await prisma.package.create({
        data: {
          name: forkName,
          slug: forkSlug,
          description: sourcePkg.description,
          type: sourcePkg.type,
          visibility: 'PRIVATE',
          tags: sourcePkg.tags,
          readme: sourcePkg.readme,
          organisationId: targetOrg.id,
          authorId: ctx.user.id,
          forkedFromId: sourcePkg.id,
          gitUri: sourcePkg.gitUri,
          gitPath: sourcePkg.gitPath,
          gitDefaultRef: sourcePkg.gitDefaultRef,
        },
        include: {
          organisation: { select: { slug: true, name: true } },
          forkedFrom: {
            select: {
              name: true,
              organisation: { select: { slug: true } },
            },
          },
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_FORKED',
        resource: 'Package',
        resourceId: forkedPkg.id,
        metadata: { forkedFromId: input.packageId, organisationId: input.organisationId },
      })

      // Notify the original package author that their package was forked
      if (sourcePkg.authorId !== ctx.user.id) {
        const actorName = ctx.user.name ?? ctx.user.email
        const pkgDisplayName = `${sourcePkg.organisation.slug}/${sourcePkg.name}`
        createNotification(prisma, {
          userId: sourcePkg.authorId,
          type: 'PACKAGE_FORKED',
          title: `${actorName} forked ${pkgDisplayName}`,
          body: `Your package was forked to ${targetOrg.slug}/${forkName}`,
          resourceId: sourcePkg.id,
          resourceType: 'package',
          actorId: ctx.user.id,
        })
      }

      return forkedPkg
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.id },
        include: {
          organisation: {
            include: {
              members: {
                where: { userId: ctx.user.id, role: { in: ['OWNER', 'ADMIN'] } },
              },
            },
          },
        },
      })

      if (!pkg || pkg.organisation.members.length === 0) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only org owners/admins can delete packages',
        })
      }

      // Best-effort git file cleanup — don't block DB deletion on failure
      const org = pkg.organisation
      try {
        if (isAgentverProvider(org)) {
          await getGitProvider().deleteSkill(org.slug, pkg.name, `Deleted package: ${pkg.name}`)
        } else if (
          org.skillsRepoProvider === 'github' &&
          org.skillsRepoOwner &&
          org.skillsRepoName
        ) {
          const token = await getGitHubToken(ctx.user.id)
          if (token) {
            await deleteSkillFromGitHub(
              org.skillsRepoOwner,
              org.skillsRepoName,
              `skills/${pkg.name}`,
              `Deleted package: ${pkg.name}`,
              token
            )
          } else {
            logger.warn('Skipping GitHub file cleanup — no connected account', {
              userId: ctx.user.id,
              packageName: pkg.name,
            })
          }
        }
      } catch (error) {
        logger.warn('Git file cleanup failed during package deletion', {
          packageName: pkg.name,
          orgSlug: org.slug,
          provider: org.skillsRepoProvider,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      await prisma.package.delete({ where: { id: input.id } })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_DELETED',
        resource: 'Package',
        resourceId: input.id,
        metadata: { name: pkg.name, slug: pkg.slug },
      })

      invalidateOnSkillWrite(pkg.organisation.slug, pkg.name).catch(() => {})

      void deliverEvent(
        pkg.organisationId,
        'skill.deleted',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        { skill: { name: pkg.name, slug: pkg.slug } }
      )

      return { success: true }
    }),

  deprecateVersion: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        versionId: z.string(),
        message: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.packageVersion.findUnique({
        where: { id: input.versionId },
        include: {
          package: {
            include: {
              organisation: {
                include: {
                  members: { where: { userId: ctx.user.id } },
                },
              },
            },
          },
        },
      })

      if (!version || version.packageId !== input.packageId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' })
      }

      const isAuthor = version.package.authorId === ctx.user.id
      const membership = version.package.organisation.members[0]
      const isAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'

      if (!isAuthor && !isAdminOrOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the package author or organisation admins can deprecate versions',
        })
      }

      await prisma.packageVersion.update({
        where: { id: input.versionId },
        data: {
          status: 'DEPRECATED',
          ...(input.message && { changelog: input.message }),
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'VERSION_DEPRECATED',
        resource: 'PackageVersion',
        resourceId: input.versionId,
        metadata: {
          packageId: input.packageId,
          version: version.version,
          message: input.message,
        },
      })

      return { success: true }
    }),

  yankVersion: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        versionId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.packageVersion.findUnique({
        where: { id: input.versionId },
        include: {
          package: {
            include: {
              organisation: {
                include: {
                  members: { where: { userId: ctx.user.id } },
                },
              },
            },
          },
        },
      })

      if (!version || version.packageId !== input.packageId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' })
      }

      const isAuthor = version.package.authorId === ctx.user.id
      const membership = version.package.organisation.members[0]
      const isAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'

      if (!isAuthor && !isAdminOrOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the package author or organisation admins can yank versions',
        })
      }

      await prisma.packageVersion.update({
        where: { id: input.versionId },
        data: { status: 'YANKED' },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'VERSION_YANKED',
        resource: 'PackageVersion',
        resourceId: input.versionId,
        metadata: {
          packageId: input.packageId,
          version: version.version,
        },
      })

      return { success: true }
    }),

  restoreVersion: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        versionId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.packageVersion.findUnique({
        where: { id: input.versionId },
        include: {
          package: {
            include: {
              organisation: {
                include: {
                  members: { where: { userId: ctx.user.id } },
                },
              },
            },
          },
        },
      })

      if (!version || version.packageId !== input.packageId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' })
      }

      const isAuthor = version.package.authorId === ctx.user.id
      const membership = version.package.organisation.members[0]
      const isAdminOrOwner = membership?.role === 'ADMIN' || membership?.role === 'OWNER'

      if (!isAuthor && !isAdminOrOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the package author or organisation admins can restore versions',
        })
      }

      await prisma.packageVersion.update({
        where: { id: input.versionId },
        data: { status: 'PUBLISHED' },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'VERSION_RESTORED',
        resource: 'PackageVersion',
        resourceId: input.versionId,
        metadata: {
          packageId: input.packageId,
          version: version.version,
        },
      })

      return { success: true }
    }),

  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const packages = await prisma.package.findMany({
        where: { id: { in: input.ids } },
        include: {
          organisation: {
            include: {
              members: {
                where: { userId: ctx.user.id, role: { in: ['OWNER', 'ADMIN'] } },
              },
            },
          },
        },
      })

      const deletable: typeof packages = []
      const errors: Array<{ id: string; name: string; error: string }> = []

      for (const pkg of packages) {
        if (pkg.organisation.members.length === 0) {
          errors.push({
            id: pkg.id,
            name: `${pkg.organisation.slug}/${pkg.name}`,
            error: 'You do not have permission to delete this package',
          })
        } else {
          deletable.push(pkg)
        }
      }

      // Report any IDs that were not found
      const foundIds = new Set(packages.map((p) => p.id))
      for (const id of input.ids) {
        if (!foundIds.has(id)) {
          errors.push({ id, name: 'unknown', error: 'Package not found' })
        }
      }

      // Best-effort git file cleanup for each deletable package
      for (const pkg of deletable) {
        const org = pkg.organisation
        try {
          if (isAgentverProvider(org)) {
            await getGitProvider().deleteSkill(org.slug, pkg.name, `Deleted package: ${pkg.name}`)
          } else if (
            org.skillsRepoProvider === 'github' &&
            org.skillsRepoOwner &&
            org.skillsRepoName
          ) {
            const token = await getGitHubToken(ctx.user.id)
            if (token) {
              await deleteSkillFromGitHub(
                org.skillsRepoOwner,
                org.skillsRepoName,
                `skills/${pkg.name}`,
                `Deleted package: ${pkg.name}`,
                token
              )
            } else {
              logger.warn('Skipping GitHub file cleanup — no connected account', {
                userId: ctx.user.id,
                packageName: pkg.name,
              })
            }
          }
        } catch (error) {
          logger.warn('Git file cleanup failed during bulk package deletion', {
            packageName: pkg.name,
            orgSlug: org.slug,
            provider: org.skillsRepoProvider,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Delete all permitted packages in a single transaction
      const deletableIds = deletable.map((p) => p.id)
      if (deletableIds.length > 0) {
        await prisma.package.deleteMany({ where: { id: { in: deletableIds } } })
      }

      // Audit, cache invalidation, and webhook delivery for each deleted package
      for (const pkg of deletable) {
        logAudit({
          userId: ctx.user.id,
          action: 'PACKAGE_DELETED',
          resource: 'Package',
          resourceId: pkg.id,
          metadata: { name: pkg.name, slug: pkg.slug },
        })

        invalidateOnSkillWrite(pkg.organisation.slug, pkg.name).catch(() => {})

        void deliverEvent(
          pkg.organisationId,
          'skill.deleted',
          { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
          { skill: { name: pkg.name, slug: pkg.slug } }
        )
      }

      return { deleted: deletable.length, errors }
    }),
})
