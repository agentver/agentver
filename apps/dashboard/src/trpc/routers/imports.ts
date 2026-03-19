import type { DetectedFileType } from '@agentver/agent-definitions'
import type { PackageType } from '@agentver/database'
import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { decryptToken, encryptToken } from '@/lib/crypto/token-encryption'
import { GitProviderConfigError, getGitProvider } from '@/lib/git'
import { getGitHubToken } from '@/lib/github/token'
import {
  fetchBitbucketFileContent,
  listBitbucketRepos,
  refreshBitbucketToken,
  scanBitbucketRepo,
} from '@/lib/import/bitbucket'
import {
  fetchFileContent,
  fetchSkillDirectoryFiles,
  getRepoDefaultBranch,
  isGitHubApiError,
  scanRepoForSkills,
} from '@/lib/import/github'
import { deleteWebhook, registerWebhook } from '@/lib/import/github-webhook'
import { fetchGitLabFileContent, refreshGitLabToken, scanGitLabRepo } from '@/lib/import/gitlab'
import {
  fetchGoogleDriveFileContent,
  listGoogleDriveFiles,
  refreshGoogleToken,
  scanGoogleDriveFolder,
} from '@/lib/import/google-drive'
import {
  fetchOneDriveFileContent,
  listOneDriveFiles,
  refreshMicrosoftToken,
  scanOneDriveFolder,
} from '@/lib/import/onedrive'
import { commitImportedFiles } from '@/lib/import/shared'
import { protectedProcedure, router } from '../init'

const logger = createLogger('imports-router')

const adoptionModeSchema = z.enum(['COPY', 'MIRROR', 'LINK']).default('COPY')

type RepoSyncConfig = {
  owner: string
  name: string
  webhookId?: number
  syncEnabled?: boolean
}

type ConnectedAccountMetadata = {
  repos?: RepoSyncConfig[]
}

const repoInputSchema = z.union([
  z.object({
    repoUrl: z.string().url(),
    repoOwner: z.string().optional(),
    repoName: z.string().optional(),
  }),
  z.object({
    repoUrl: z.string().optional(),
    repoOwner: z.string().min(1),
    repoName: z.string().min(1),
  }),
])

function parseRepoUrl(url: string): { owner: string; name: string } {
  const ghUrlPattern = /github\.com\/([^/]+)\/([^/.]+)/
  const match = url.match(ghUrlPattern)

  if (match?.[1] && match[2]) {
    return { owner: match[1], name: match[2] }
  }

  // Try owner/repo format
  const slashPattern = /^([^/]+)\/([^/]+)$/
  const slashMatch = url.match(slashPattern)

  if (slashMatch?.[1] && slashMatch[2]) {
    return { owner: slashMatch[1], name: slashMatch[2] }
  }

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'Invalid repository URL. Use https://github.com/owner/repo or owner/repo format.',
  })
}

async function getGitLabAccessToken(
  userId: string
): Promise<{ accessToken: string; accountId: string }> {
  const account = await prisma.connectedAccount.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: 'GITLAB',
      },
    },
    select: { id: true, accessToken: true, refreshToken: true, expiresAt: true },
  })

  if (!account) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No GitLab account connected. Please connect your GitLab account first.',
    })
  }

  const shouldRefresh =
    account.refreshToken &&
    (!account.expiresAt || account.expiresAt.getTime() - Date.now() < 5 * 60 * 1_000)

  if (shouldRefresh) {
    try {
      const result = await refreshGitLabToken(decryptToken(account.refreshToken!))

      const updateData: { accessToken: string; refreshToken?: string; expiresAt: Date } = {
        accessToken: encryptToken(result.accessToken),
        expiresAt: result.expiresAt,
      }

      if (result.refreshToken) {
        updateData.refreshToken = encryptToken(result.refreshToken)
      }

      await prisma.connectedAccount.update({
        where: {
          userId_provider: {
            userId,
            provider: 'GITLAB',
          },
        },
        data: updateData,
      })

      return { accessToken: result.accessToken, accountId: account.id }
    } catch (error) {
      logger.error('GitLab token refresh failed', { userId, error })
      throw new Error(
        'GitLab token refresh failed. Please reconnect your GitLab account in Settings.'
      )
    }
  }

  return { accessToken: decryptToken(account.accessToken), accountId: account.id }
}

type ScannedFile = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  downloadUrl: string
  preview: string | null
}

type ScannedGitLabFile = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  projectId: number
  ref: string
  preview: string | null
}

const bitbucketRepoInputSchema = z.union([
  z.object({
    repoUrl: z.string().url(),
    workspace: z.string().optional(),
    repoSlug: z.string().optional(),
  }),
  z.object({
    repoUrl: z.string().optional(),
    workspace: z.string().min(1),
    repoSlug: z.string().min(1),
  }),
])

function parseBitbucketRepoUrl(url: string): { workspace: string; repoSlug: string } {
  // Handles https://bitbucket.org/workspace/repo, https://bitbucket.org/workspace/repo.git, workspace/repo
  const bbUrlPattern = /bitbucket\.org\/([^/]+)\/([^/.]+)/
  const match = url.match(bbUrlPattern)

  if (match?.[1] && match[2]) {
    return { workspace: match[1], repoSlug: match[2] }
  }

  // Try workspace/repo format
  const slashPattern = /^([^/]+)\/([^/]+)$/
  const slashMatch = url.match(slashPattern)

  if (slashMatch?.[1] && slashMatch[2]) {
    return { workspace: slashMatch[1], repoSlug: slashMatch[2] }
  }

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message:
      'Invalid repository URL. Use https://bitbucket.org/workspace/repo or workspace/repo format.',
  })
}

async function getBitbucketAccessToken(
  userId: string
): Promise<{ accessToken: string; accountId: string }> {
  const account = await prisma.connectedAccount.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: 'BITBUCKET',
      },
    },
    select: { id: true, accessToken: true, refreshToken: true, expiresAt: true },
  })

  if (!account) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No Bitbucket account connected. Please connect your Bitbucket account first.',
    })
  }

  const shouldRefresh =
    account.refreshToken &&
    (!account.expiresAt || account.expiresAt.getTime() - Date.now() < 5 * 60 * 1_000)

  if (shouldRefresh) {
    try {
      const result = await refreshBitbucketToken(decryptToken(account.refreshToken!))

      const updateData: { accessToken: string; refreshToken?: string; expiresAt: Date } = {
        accessToken: encryptToken(result.accessToken),
        expiresAt: result.expiresAt,
      }

      if (result.refreshToken) {
        updateData.refreshToken = encryptToken(result.refreshToken)
      }

      await prisma.connectedAccount.update({
        where: {
          userId_provider: {
            userId,
            provider: 'BITBUCKET',
          },
        },
        data: updateData,
      })

      return { accessToken: result.accessToken, accountId: account.id }
    } catch (error) {
      logger.error('Bitbucket token refresh failed', { userId, error })
      throw new Error(
        'Bitbucket token refresh failed. Please reconnect your Bitbucket account in Settings.'
      )
    }
  }

  return { accessToken: decryptToken(account.accessToken), accountId: account.id }
}

type ScannedBitbucketFile = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  downloadUrl: string
  preview: string | null
}

async function getGoogleAccessToken(
  userId: string
): Promise<{ accessToken: string; refreshToken: string; accountId: string }> {
  const account = await prisma.connectedAccount.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: 'GOOGLE',
      },
    },
    select: { id: true, accessToken: true, refreshToken: true, expiresAt: true },
  })

  if (!account) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No Google account connected. Please connect your Google account first.',
    })
  }

  const shouldRefresh =
    account.refreshToken &&
    (!account.expiresAt || account.expiresAt.getTime() - Date.now() < 5 * 60 * 1_000)

  if (shouldRefresh) {
    try {
      const result = await refreshGoogleToken(decryptToken(account.refreshToken!))

      await prisma.connectedAccount.update({
        where: {
          userId_provider: {
            userId,
            provider: 'GOOGLE',
          },
        },
        data: {
          accessToken: encryptToken(result.accessToken),
          expiresAt: result.expiresAt,
        },
      })

      return {
        accessToken: result.accessToken,
        refreshToken: decryptToken(account.refreshToken!),
        accountId: account.id,
      }
    } catch (error) {
      logger.error('Google token refresh failed', { userId, error })
      throw new Error(
        'Google Drive token refresh failed. Please reconnect your Google account in Settings.'
      )
    }
  }

  return {
    accessToken: decryptToken(account.accessToken),
    refreshToken: account.refreshToken ? decryptToken(account.refreshToken) : '',
    accountId: account.id,
  }
}

async function getMicrosoftAccessToken(
  userId: string
): Promise<{ accessToken: string; refreshToken: string; accountId: string }> {
  const account = await prisma.connectedAccount.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: 'MICROSOFT',
      },
    },
    select: { id: true, accessToken: true, refreshToken: true, expiresAt: true },
  })

  if (!account) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No Microsoft account connected. Please connect your Microsoft account first.',
    })
  }

  const shouldRefresh =
    account.refreshToken &&
    (!account.expiresAt || account.expiresAt.getTime() - Date.now() < 5 * 60 * 1_000)

  if (shouldRefresh) {
    try {
      const result = await refreshMicrosoftToken(decryptToken(account.refreshToken!))

      await prisma.connectedAccount.update({
        where: {
          userId_provider: {
            userId,
            provider: 'MICROSOFT',
          },
        },
        data: {
          accessToken: encryptToken(result.accessToken),
          expiresAt: result.expiresAt,
        },
      })

      return {
        accessToken: result.accessToken,
        refreshToken: decryptToken(account.refreshToken!),
        accountId: account.id,
      }
    } catch (error) {
      logger.error('Microsoft token refresh failed', { userId, error })
      throw new Error(
        'OneDrive token refresh failed. Please reconnect your Microsoft account in Settings.'
      )
    }
  }

  return {
    accessToken: decryptToken(account.accessToken),
    refreshToken: account.refreshToken ? decryptToken(account.refreshToken) : '',
    accountId: account.id,
  }
}

type ScannedGoogleDriveFile = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  fileId: string
  preview: string | null
}

type ScannedOneDriveFileWithPreview = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  itemId: string
  preview: string | null
}

// ---------------------------------------------------------------------------
// Shared adoption helpers
// ---------------------------------------------------------------------------

const PACKAGE_TYPE_MAP: Record<string, PackageType> = {
  SKILL: 'SKILL',
  AGENT_CONFIG: 'AGENT_CONFIG',
  PLUGIN: 'PLUGIN',
  SCRIPT: 'SCRIPT',
  PROMPT: 'PROMPT',
}

function deriveBaseName(fileName: string): string {
  return (
    fileName
      .replace(/\.(md|txt|yaml|yml|json|toml|py|ts|js|sh|bash|zsh)$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'imported-file'
  )
}

type AdoptionContext = {
  orgId: string
  orgSlug: string
  userId: string
  adoptionMode: 'COPY' | 'MIRROR' | 'LINK'
  sourceProvider: string
  sourceUri: string
  sourceRef?: string
  /** The org's skills repo provider — 'agentver' for Forgejo-backed storage */
  skillsRepoProvider?: string | null
}

type FileToAdopt = {
  path: string
  name: string
  content: string
  detectedType: string
  agentId: string
  /** Additional files from a skill directory (e.g. helper scripts, configs) */
  additionalFiles?: Array<{ name: string; content: string }>
}

/**
 * Adopt a single file using the appropriate strategy for the adoption mode.
 *
 * - COPY: commit to skills repo via commitImportedFiles, create Package + PackageVersion
 * - LINK: create Package pointing to source + initial PackageVersion, no commit
 * - MIRROR: same as COPY + store source metadata for future sync
 */
async function adoptFile(
  ctx: AdoptionContext,
  file: FileToAdopt
): Promise<{ packageId: string; name: string }> {
  const baseName = deriveBaseName(file.name)
  const packageType = PACKAGE_TYPE_MAP[file.detectedType] ?? 'SKILL'

  if (ctx.adoptionMode === 'LINK') {
    const existing = await prisma.package.findUnique({
      where: {
        organisationId_name: {
          organisationId: ctx.orgId,
          name: baseName,
        },
      },
    })

    if (existing) {
      throw new Error(`Package "${baseName}" already exists`)
    }

    const isGitSource =
      ctx.sourceProvider === 'github' ||
      ctx.sourceProvider === 'gitlab' ||
      ctx.sourceProvider === 'bitbucket'

    const slug = `${ctx.orgSlug}/${baseName}`

    const { pkg, version } = await prisma.$transaction(async (tx) => {
      const pkg = await tx.package.create({
        data: {
          name: baseName,
          slug,
          description: `Linked from ${ctx.sourceProvider}: ${ctx.sourceUri}/${file.path}`,
          type: packageType,
          tags: [file.agentId, 'linked', ctx.sourceProvider],
          organisationId: ctx.orgId,
          authorId: ctx.userId,
          gitUri: isGitSource ? ctx.sourceUri : undefined,
          gitPath: file.path,
          gitDefaultRef: isGitSource ? (ctx.sourceRef ?? 'main') : '',
          readme: file.content || undefined,
        },
      })

      const version = await tx.packageVersion.create({
        data: {
          packageId: pkg.id,
          version: '0.0.1',
          changelog: 'Initial linked version',
          gitRef: isGitSource ? (ctx.sourceRef ?? undefined) : undefined,
        },
      })

      return { pkg, version }
    })

    logger.info('Linked package created', {
      packageId: pkg.id,
      versionId: version.id,
      sourceProvider: ctx.sourceProvider,
      isGitSource,
    })

    return { packageId: pkg.id, name: baseName }
  }

  // COPY or MIRROR: commit file(s) to the org's skills repo
  const targetPath = `skills/${baseName}`
  const commitMessage = `Adopt ${file.name} from ${ctx.sourceProvider}`

  // Build the full list of files to commit
  const filesToCommit = [{ name: file.name, content: file.content }]
  if (file.additionalFiles) {
    for (const extra of file.additionalFiles) {
      // Avoid duplicating the primary file
      if (extra.name !== file.name) {
        filesToCommit.push(extra)
      }
    }
  }

  // Agentver Forgejo path
  if (ctx.skillsRepoProvider === 'agentver') {
    const forgejoResult = await getGitProvider().createSkill(
      ctx.orgSlug,
      baseName,
      filesToCommit.map((f) => ({ path: f.name, content: f.content })),
      commitMessage
    )

    try {
      const slug = `${ctx.orgSlug}/${baseName}`
      const pkg = await prisma.$transaction(async (tx) => {
        const pkg = await tx.package.upsert({
          where: {
            organisationId_name: {
              organisationId: ctx.orgId,
              name: baseName,
            },
          },
          update: { updatedAt: new Date() },
          create: {
            name: baseName,
            slug,
            type: packageType,
            organisationId: ctx.orgId,
            authorId: ctx.userId,
            gitUri: `agentver://${ctx.orgSlug}`,
            gitPath: targetPath,
            gitDefaultRef: 'main',
          },
        })

        await tx.packageVersion.create({
          data: {
            packageId: pkg.id,
            version: `0.0.0+${forgejoResult.commitSha.slice(0, 7)}`,
            gitRef: 'main',
            gitCommitSha: forgejoResult.commitSha,
            changelog: commitMessage,
          },
        })

        if (ctx.adoptionMode === 'MIRROR') {
          const newTags = [file.agentId, 'mirrored', ctx.sourceProvider].filter(Boolean)
          const mergedTags = [...new Set([...pkg.tags, ...newTags])]

          await tx.package.update({
            where: { id: pkg.id },
            data: {
              tags: mergedTags,
              description: `Mirrored from ${ctx.sourceProvider}: ${ctx.sourceUri}/${file.path}`,
            },
          })
        }

        return pkg
      })

      return { packageId: pkg.id, name: baseName }
    } catch (error) {
      logger.error(
        'Database transaction failed after Forgejo commit — orphaned commit requires manual cleanup',
        {
          commitSha: forgejoResult.commitSha,
          orgSlug: ctx.orgSlug,
          file: file.name,
          baseName,
          error: error instanceof Error ? error.message : String(error),
        }
      )
      throw error
    }
  }

  // GitHub-backed path
  const importOrigin =
    ctx.sourceProvider === 'github' ||
    ctx.sourceProvider === 'gitlab' ||
    ctx.sourceProvider === 'bitbucket'
      ? undefined
      : {
          provider: ctx.sourceProvider as 'google-drive' | 'onedrive' | 'upload',
          sourceId: ctx.sourceUri,
          importedAt: new Date().toISOString(),
          importedBy: ctx.userId,
        }

  const result = await commitImportedFiles(
    ctx.orgId,
    filesToCommit,
    targetPath,
    commitMessage,
    ctx.userId,
    importOrigin
  )

  // For MIRROR mode, store source info as tags and in description for future sync detection
  if (ctx.adoptionMode === 'MIRROR') {
    const existingPkg = await prisma.package.findUnique({
      where: { id: result.packageId },
      select: { tags: true },
    })
    const existingTags = existingPkg?.tags ?? []
    const newTags = [file.agentId, 'mirrored', ctx.sourceProvider].filter(Boolean)
    const mergedTags = [...new Set([...existingTags, ...newTags])]

    await prisma.package.update({
      where: { id: result.packageId },
      data: {
        tags: mergedTags,
        description: `Mirrored from ${ctx.sourceProvider}: ${ctx.sourceUri}/${file.path}`,
      },
    })
  }

  return { packageId: result.packageId, name: baseName }
}

/**
 * Check if the org has a skills repo connected. Required for COPY/MIRROR modes.
 * Accepts either a GitHub-backed repo or Agentver-hosted storage.
 * Returns the org or throws a descriptive error.
 */
async function validateOrgForAdoption(
  orgId: string,
  userId: string,
  adoptionMode: 'COPY' | 'MIRROR' | 'LINK'
): Promise<{
  id: string
  slug: string
  skillsRepoUrl: string | null
  skillsRepoOwner: string | null
  skillsRepoName: string | null
  skillsRepoProvider: string | null
}> {
  const org = await prisma.organisation.findUnique({
    where: { id: orgId },
    include: {
      members: { where: { userId } },
    },
  })

  if (!org || org.members.length === 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Not a member of this organisation',
    })
  }

  if (adoptionMode !== 'LINK') {
    const hasAgentverGit = org.skillsRepoProvider === 'agentver'
    const hasExternalRepo = !!org.skillsRepoUrl && !!org.skillsRepoOwner && !!org.skillsRepoName

    if (!hasAgentverGit && !hasExternalRepo) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'No skills repository connected. Connect a skills repository in Settings > Organisation before importing with Copy or Mirror mode.',
      })
    }
  }

  return {
    id: org.id,
    slug: org.slug,
    skillsRepoUrl: org.skillsRepoUrl,
    skillsRepoOwner: org.skillsRepoOwner,
    skillsRepoName: org.skillsRepoName,
    skillsRepoProvider: org.skillsRepoProvider,
  }
}

/**
 * Run adoption for a batch of files, collecting results and errors.
 */
async function adoptFiles(
  ctx: AdoptionContext,
  files: FileToAdopt[]
): Promise<{
  imported: Array<{ path: string; packageId: string; name: string }>
  errors: Array<{ path: string; error: string }>
}> {
  const imported: Array<{ path: string; packageId: string; name: string }> = []
  const errors: Array<{ path: string; error: string }> = []

  for (const file of files) {
    try {
      const result = await adoptFile(ctx, file)
      imported.push({ path: file.path, packageId: result.packageId, name: result.name })
    } catch (err) {
      if (err instanceof GitProviderConfigError) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: err.message })
      }
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Failed to adopt file', { path: file.path, error: message })
      errors.push({ path: file.path, error: message })
    }
  }

  return { imported, errors }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const importsRouter = router({
  scanGitHub: protectedProcedure.input(repoInputSchema).mutation(async ({ ctx, input }) => {
    // Soft token fetch — returns null if no GitHub account is connected,
    // allowing unauthenticated scanning of public repositories.
    const token = await getGitHubToken(ctx.user.id)

    let owner: string
    let name: string

    if (input.repoUrl) {
      const parsed = parseRepoUrl(input.repoUrl)
      owner = parsed.owner
      name = parsed.name
    } else if (input.repoOwner && input.repoName) {
      owner = input.repoOwner
      name = input.repoName
    } else {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Provide either a repository URL or owner/name.',
      })
    }

    logger.info('Scanning GitHub repository', {
      owner,
      name,
      userId: ctx.user.id,
      authenticated: !!token,
    })

    let rawFiles: Awaited<ReturnType<typeof scanRepoForSkills>>

    try {
      rawFiles = await scanRepoForSkills(owner, name, token)
    } catch (error) {
      if (isGitHubApiError(error)) {
        if (error.rateLimited && !token) {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message:
              'GitHub API rate limit exceeded. Connect your GitHub account for higher rate limits (5,000 requests/hour vs 60).',
          })
        }
        if (error.rateLimited) {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: 'GitHub API rate limit exceeded. Please try again later.',
          })
        }
        if ((error.status === 404 || error.status === 403) && !token) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message:
              'Repository not found or private. Connect your GitHub account to access private repositories and increase API rate limits.',
          })
        }
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Could not access repository ${owner}/${name}. It may not exist or you may not have permission.`,
        })
      }
      throw error
    }

    const DETECTED_TYPE_SORT_ORDER: Record<DetectedFileType, number> = {
      AGENT_CONFIG: 0,
      SKILL: 1,
      PROMPT: 2,
      PLUGIN: 3,
      SCRIPT: 4,
    }

    const files: ScannedFile[] = await Promise.all(
      rawFiles.map(async (file) => {
        let preview: string | null = null

        if (file.downloadUrl) {
          try {
            const content = await fetchFileContent(file.downloadUrl, token)
            preview = content.length > 500 ? `${content.slice(0, 500)}...` : content
          } catch {
            logger.warn('Failed to fetch preview', { path: file.path })
          }
        }

        return {
          path: file.path,
          name: file.name,
          type: file.type,
          detectedType: file.detectedType,
          agentId: file.agentId,
          downloadUrl: file.downloadUrl,
          preview,
        }
      })
    )

    files.sort(
      (a, b) =>
        (DETECTED_TYPE_SORT_ORDER[a.detectedType] ?? 99) -
        (DETECTED_TYPE_SORT_ORDER[b.detectedType] ?? 99)
    )

    return {
      repo: `${owner}/${name}`,
      files,
    }
  }),

  importFromGitHub: protectedProcedure
    .input(
      z.object({
        repo: z.string(),
        organisationId: z.string(),
        adoptionMode: adoptionModeSchema,
        files: z.array(
          z.object({
            path: z.string(),
            name: z.string(),
            type: z.enum(['skill', 'config', 'rules']),
            detectedType: z.enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT']),
            agentId: z.string(),
            downloadUrl: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const token = await getGitHubToken(ctx.user.id)
      const org = await validateOrgForAdoption(
        input.organisationId,
        ctx.user.id,
        input.adoptionMode
      )

      logger.info('Adopting files from GitHub', {
        repo: input.repo,
        fileCount: input.files.length,
        adoptionMode: input.adoptionMode,
        userId: ctx.user.id,
      })

      // Fetch file contents and build adoption list
      const filesToAdopt: FileToAdopt[] = []
      const fetchErrors: Array<{ path: string; error: string }> = []

      const [repoOwnerParsed, repoNameParsed] = input.repo.split('/')

      for (const file of input.files) {
        try {
          if (file.type === 'skill' && !file.downloadUrl && repoOwnerParsed && repoNameParsed) {
            // Skill directory — fetch all files within it
            const dirFiles = await fetchSkillDirectoryFiles(
              token,
              repoOwnerParsed,
              repoNameParsed,
              file.path
            )

            // Find the primary SKILL.md (or first .md file as fallback)
            const primaryFile =
              dirFiles.find((f) => f.name === 'SKILL.md') ??
              dirFiles.find((f) => f.name.endsWith('.md')) ??
              dirFiles[0]

            if (!primaryFile) {
              fetchErrors.push({ path: file.path, error: 'No files found in skill directory' })
              continue
            }

            filesToAdopt.push({
              path: file.path,
              name: file.name,
              content: primaryFile.content,
              detectedType: file.detectedType,
              agentId: file.agentId,
              additionalFiles: dirFiles,
            })
          } else {
            // Single file (config, rules, or file with download URL)
            const content = file.downloadUrl ? await fetchFileContent(file.downloadUrl, token) : ''
            filesToAdopt.push({
              path: file.path,
              name: file.name,
              content,
              detectedType: file.detectedType,
              agentId: file.agentId,
            })
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.error('Failed to fetch file content', { path: file.path, error: message })
          fetchErrors.push({ path: file.path, error: `Failed to fetch content: ${message}` })
        }
      }

      const [repoOwner, repoName] = input.repo.split('/')
      const defaultBranch =
        repoOwner && repoName ? await getRepoDefaultBranch(token, repoOwner, repoName) : 'main'

      const adoptionCtx: AdoptionContext = {
        orgId: org.id,
        orgSlug: org.slug,
        userId: ctx.user.id,
        adoptionMode: input.adoptionMode,
        sourceProvider: 'github',
        sourceUri: `github.com/${input.repo}`,
        sourceRef: defaultBranch,
        skillsRepoProvider: org.skillsRepoProvider,
      }

      const { imported, errors } = await adoptFiles(adoptionCtx, filesToAdopt)

      // For MIRROR mode with GitHub source, enable webhook sync
      let syncStatus: 'active' | 'failed' | 'not_requested' = 'not_requested'

      if (input.adoptionMode === 'MIRROR' && imported.length > 0) {
        const [repoOwner, repoName] = input.repo.split('/')
        if (!token) {
          syncStatus = 'failed'
          logger.warn('Mirror sync requires a connected GitHub account for webhook registration', {
            repo: input.repo,
          })
        } else if (repoOwner && repoName) {
          try {
            const account = await prisma.connectedAccount.findUnique({
              where: { userId_provider: { userId: ctx.user.id, provider: 'GITHUB' } },
            })

            if (account) {
              const metadata = (account.metadata as ConnectedAccountMetadata | null) ?? {}
              const existingRepos = metadata.repos ?? []
              const existingRepo = existingRepos.find(
                (r) =>
                  r.owner.toLowerCase() === repoOwner.toLowerCase() &&
                  r.name.toLowerCase() === repoName.toLowerCase() &&
                  r.syncEnabled
              )

              if (existingRepo?.webhookId) {
                syncStatus = 'active'
                logger.info('GitHub mirror sync already active, skipping webhook registration', {
                  repoOwner,
                  repoName,
                  webhookId: existingRepo.webhookId,
                })
              } else {
                const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
                if (baseUrl) {
                  const webhookUrl = `${baseUrl}/api/webhooks/github`
                  const { webhookId } = await registerWebhook(
                    token,
                    repoOwner,
                    repoName,
                    webhookUrl
                  )

                  const filteredRepos = existingRepos.filter(
                    (r) =>
                      r.owner.toLowerCase() !== repoOwner.toLowerCase() ||
                      r.name.toLowerCase() !== repoName.toLowerCase()
                  )
                  const updatedRepos: RepoSyncConfig[] = [
                    ...filteredRepos,
                    { owner: repoOwner, name: repoName, webhookId, syncEnabled: true },
                  ]
                  await prisma.connectedAccount.update({
                    where: { id: account.id },
                    data: { metadata: { ...metadata, repos: updatedRepos } },
                  })

                  syncStatus = 'active'
                  logger.info('GitHub mirror sync enabled', { repoOwner, repoName, webhookId })
                } else {
                  syncStatus = 'failed'
                  logger.warn(
                    'Failed to enable mirror sync webhook: no application URL configured',
                    {
                      repo: input.repo,
                    }
                  )
                }
              }
            }
          } catch (err) {
            syncStatus = 'failed'
            logger.warn('Failed to enable mirror sync webhook', {
              repo: input.repo,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        } else {
          syncStatus = 'failed'
          logger.warn('Failed to enable mirror sync webhook: could not parse repo owner/name', {
            repo: input.repo,
          })
        }
      }

      logger.info('GitHub import complete', {
        imported: imported.length,
        failed: errors.length + fetchErrors.length,
        syncStatus,
      })

      logAudit({
        userId: ctx.user.id,
        action: 'IMPORT_COMPLETED',
        resource: 'Organisation',
        resourceId: input.organisationId,
        metadata: {
          source: 'github',
          repo: input.repo,
          adoptionMode: input.adoptionMode,
          importedCount: imported.length,
          errorCount: errors.length + fetchErrors.length,
          organisationId: input.organisationId,
        },
      })

      return { imported, errors: [...fetchErrors, ...errors], syncStatus }
    }),

  scanGitLab: protectedProcedure
    .input(
      z.object({
        projectId: z.number().optional(),
        projectPath: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { accessToken } = await getGitLabAccessToken(ctx.user.id)

      const DETECTED_TYPE_SORT_ORDER: Record<DetectedFileType, number> = {
        AGENT_CONFIG: 0,
        SKILL: 1,
        PROMPT: 2,
        PLUGIN: 3,
        SCRIPT: 4,
      }

      let resolvedProjectId: number
      let resolvedPath: string
      let resolvedDefaultBranch: string

      if (input.projectPath) {
        const encodedPath = encodeURIComponent(input.projectPath)
        const response = await fetch(`https://gitlab.com/api/v4/projects/${encodedPath}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })

        if (!response.ok) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `GitLab project not found: ${input.projectPath}`,
          })
        }

        const project = (await response.json()) as {
          id: number
          path_with_namespace: string
          default_branch: string
        }

        resolvedProjectId = project.id
        resolvedPath = project.path_with_namespace
        resolvedDefaultBranch = project.default_branch
      } else if (input.projectId) {
        const response = await fetch(`https://gitlab.com/api/v4/projects/${input.projectId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })

        if (!response.ok) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `GitLab project not found: ${input.projectId}`,
          })
        }

        const project = (await response.json()) as {
          id: number
          path_with_namespace: string
          default_branch: string
        }

        resolvedProjectId = project.id
        resolvedPath = project.path_with_namespace
        resolvedDefaultBranch = project.default_branch
      } else {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Provide either a project ID or project path.',
        })
      }

      logger.info('Scanning GitLab project', {
        projectId: resolvedProjectId,
        projectPath: resolvedPath,
        userId: ctx.user.id,
      })

      const rawFiles = await scanGitLabRepo(accessToken, resolvedProjectId, resolvedDefaultBranch)

      const files: ScannedGitLabFile[] = await Promise.all(
        rawFiles.map(async (file) => {
          let preview: string | null = null

          try {
            const content = await fetchGitLabFileContent(
              accessToken,
              file.projectId,
              file.path,
              file.ref
            )
            preview = content.length > 500 ? `${content.slice(0, 500)}...` : content
          } catch {
            logger.warn('Failed to fetch GitLab preview', { path: file.path })
          }

          return {
            path: file.path,
            name: file.name,
            type: file.type,
            detectedType: file.detectedType,
            agentId: file.agentId,
            projectId: file.projectId,
            ref: file.ref,
            preview,
          }
        })
      )

      files.sort(
        (a, b) =>
          (DETECTED_TYPE_SORT_ORDER[a.detectedType] ?? 99) -
          (DETECTED_TYPE_SORT_ORDER[b.detectedType] ?? 99)
      )

      return {
        repo: resolvedPath,
        projectId: resolvedProjectId,
        defaultBranch: resolvedDefaultBranch,
        files,
      }
    }),

  importFromGitLab: protectedProcedure
    .input(
      z.object({
        repo: z.string(),
        projectId: z.number(),
        organisationId: z.string(),
        adoptionMode: adoptionModeSchema,
        files: z.array(
          z.object({
            path: z.string(),
            name: z.string(),
            type: z.enum(['skill', 'config', 'rules']),
            detectedType: z.enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT']),
            agentId: z.string(),
            projectId: z.number(),
            ref: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.adoptionMode === 'MIRROR') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Mirror sync is not yet supported for GitLab. Use Copy or Link mode instead.',
        })
      }

      const { accessToken } = await getGitLabAccessToken(ctx.user.id)
      const org = await validateOrgForAdoption(
        input.organisationId,
        ctx.user.id,
        input.adoptionMode
      )

      logger.info('Adopting files from GitLab', {
        repo: input.repo,
        fileCount: input.files.length,
        adoptionMode: input.adoptionMode,
        userId: ctx.user.id,
      })

      const filesToAdopt: FileToAdopt[] = []
      const fetchErrors: Array<{ path: string; error: string }> = []

      for (const file of input.files) {
        try {
          const content = await fetchGitLabFileContent(
            accessToken,
            file.projectId,
            file.path,
            file.ref
          )
          filesToAdopt.push({
            path: file.path,
            name: file.name,
            content,
            detectedType: file.detectedType,
            agentId: file.agentId,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.error('Failed to fetch GitLab file content', { path: file.path, error: message })
          fetchErrors.push({ path: file.path, error: `Failed to fetch content: ${message}` })
        }
      }

      const adoptionCtx: AdoptionContext = {
        orgId: org.id,
        orgSlug: org.slug,
        userId: ctx.user.id,
        adoptionMode: input.adoptionMode,
        sourceProvider: 'gitlab',
        sourceUri: `gitlab.com/${input.repo}`,
        sourceRef: input.files[0]?.ref ?? 'main',
        skillsRepoProvider: org.skillsRepoProvider,
      }

      const { imported, errors } = await adoptFiles(adoptionCtx, filesToAdopt)

      logger.info('GitLab import complete', {
        imported: imported.length,
        failed: errors.length + fetchErrors.length,
      })

      logAudit({
        userId: ctx.user.id,
        action: 'IMPORT_COMPLETED',
        resource: 'Organisation',
        resourceId: input.organisationId,
        metadata: {
          source: 'gitlab',
          repo: input.repo,
          adoptionMode: input.adoptionMode,
          importedCount: imported.length,
          errorCount: errors.length + fetchErrors.length,
          organisationId: input.organisationId,
        },
      })

      return { imported, errors: [...fetchErrors, ...errors] }
    }),

  scanBitbucket: protectedProcedure
    .input(bitbucketRepoInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { accessToken } = await getBitbucketAccessToken(ctx.user.id)

      let workspace: string
      let repoSlug: string

      if (input.repoUrl) {
        const parsed = parseBitbucketRepoUrl(input.repoUrl)
        workspace = parsed.workspace
        repoSlug = parsed.repoSlug
      } else if (input.workspace && input.repoSlug) {
        workspace = input.workspace
        repoSlug = input.repoSlug
      } else {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Provide either a repository URL or workspace/repo-slug.',
        })
      }

      logger.info('Scanning Bitbucket repository', {
        workspace,
        repoSlug,
        userId: ctx.user.id,
      })

      // Fetch the repo to get the default branch
      const repos = await listBitbucketRepos(accessToken)
      const repo = repos.find(
        (r) =>
          r.workspace.toLowerCase() === workspace.toLowerCase() &&
          r.slug.toLowerCase() === repoSlug.toLowerCase()
      )
      const mainBranch = repo?.defaultBranch ?? 'main'

      const rawFiles = await scanBitbucketRepo(accessToken, workspace, repoSlug, mainBranch)

      const DETECTED_TYPE_SORT_ORDER: Record<DetectedFileType, number> = {
        AGENT_CONFIG: 0,
        SKILL: 1,
        PROMPT: 2,
        PLUGIN: 3,
        SCRIPT: 4,
      }

      const files: ScannedBitbucketFile[] = await Promise.all(
        rawFiles.map(async (file) => {
          let preview: string | null = null

          if (file.downloadUrl) {
            try {
              const content = await fetchBitbucketFileContent(
                accessToken,
                workspace,
                repoSlug,
                file.path,
                mainBranch
              )
              preview = content.length > 500 ? `${content.slice(0, 500)}...` : content
            } catch {
              logger.warn('Failed to fetch preview', { path: file.path })
            }
          }

          return {
            path: file.path,
            name: file.name,
            type: file.type,
            detectedType: file.detectedType,
            agentId: file.agentId,
            downloadUrl: file.downloadUrl,
            preview,
          }
        })
      )

      files.sort(
        (a, b) =>
          (DETECTED_TYPE_SORT_ORDER[a.detectedType] ?? 99) -
          (DETECTED_TYPE_SORT_ORDER[b.detectedType] ?? 99)
      )

      return {
        repo: `${workspace}/${repoSlug}`,
        mainBranch,
        files,
      }
    }),

  importFromBitbucket: protectedProcedure
    .input(
      z.object({
        repo: z.string(),
        workspace: z.string(),
        repoSlug: z.string(),
        mainBranch: z.string(),
        organisationId: z.string(),
        adoptionMode: adoptionModeSchema,
        files: z.array(
          z.object({
            path: z.string(),
            name: z.string(),
            type: z.enum(['skill', 'config', 'rules']),
            detectedType: z.enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT']),
            agentId: z.string(),
            downloadUrl: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.adoptionMode === 'MIRROR') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Mirror sync is not yet supported for Bitbucket. Use Copy or Link mode instead.',
        })
      }

      const { accessToken } = await getBitbucketAccessToken(ctx.user.id)
      const org = await validateOrgForAdoption(
        input.organisationId,
        ctx.user.id,
        input.adoptionMode
      )

      logger.info('Adopting files from Bitbucket', {
        repo: input.repo,
        fileCount: input.files.length,
        adoptionMode: input.adoptionMode,
        userId: ctx.user.id,
      })

      const filesToAdopt: FileToAdopt[] = []
      const fetchErrors: Array<{ path: string; error: string }> = []

      for (const file of input.files) {
        try {
          const content = file.downloadUrl
            ? await fetchBitbucketFileContent(
                accessToken,
                input.workspace,
                input.repoSlug,
                file.path,
                input.mainBranch
              )
            : ''
          filesToAdopt.push({
            path: file.path,
            name: file.name,
            content,
            detectedType: file.detectedType,
            agentId: file.agentId,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.error('Failed to fetch Bitbucket file content', {
            path: file.path,
            error: message,
          })
          fetchErrors.push({ path: file.path, error: `Failed to fetch content: ${message}` })
        }
      }

      const adoptionCtx: AdoptionContext = {
        orgId: org.id,
        orgSlug: org.slug,
        userId: ctx.user.id,
        adoptionMode: input.adoptionMode,
        sourceProvider: 'bitbucket',
        sourceUri: `bitbucket.org/${input.repo}`,
        sourceRef: input.mainBranch,
        skillsRepoProvider: org.skillsRepoProvider,
      }

      const { imported, errors } = await adoptFiles(adoptionCtx, filesToAdopt)

      logger.info('Bitbucket import complete', {
        imported: imported.length,
        failed: errors.length + fetchErrors.length,
      })

      logAudit({
        userId: ctx.user.id,
        action: 'IMPORT_COMPLETED',
        resource: 'Organisation',
        resourceId: input.organisationId,
        metadata: {
          source: 'bitbucket',
          repo: input.repo,
          adoptionMode: input.adoptionMode,
          importedCount: imported.length,
          errorCount: errors.length + fetchErrors.length,
          organisationId: input.organisationId,
        },
      })

      return { imported, errors: [...fetchErrors, ...errors] }
    }),

  enableGitHubSync: protectedProcedure
    .input(
      z.object({
        repoOwner: z.string().min(1),
        repoName: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const account = await prisma.connectedAccount.findUnique({
        where: {
          userId_provider: {
            userId: ctx.user.id,
            provider: 'GITHUB',
          },
        },
      })

      if (!account) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No GitHub account connected. Please connect your GitHub account first.',
        })
      }

      const metadata = (account.metadata as ConnectedAccountMetadata | null) ?? {}
      const existingRepos = metadata.repos ?? []
      const existingRepo = existingRepos.find(
        (r) =>
          r.owner.toLowerCase() === input.repoOwner.toLowerCase() &&
          r.name.toLowerCase() === input.repoName.toLowerCase() &&
          r.syncEnabled
      )

      if (existingRepo?.webhookId) {
        return { webhookId: existingRepo.webhookId, syncEnabled: true }
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
      if (!baseUrl) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Application URL not configured',
        })
      }

      const webhookUrl = `${baseUrl}/api/webhooks/github`

      const { webhookId } = await registerWebhook(
        account.accessToken,
        input.repoOwner,
        input.repoName,
        webhookUrl
      )

      const filteredRepos = existingRepos.filter(
        (r) =>
          r.owner.toLowerCase() !== input.repoOwner.toLowerCase() ||
          r.name.toLowerCase() !== input.repoName.toLowerCase()
      )

      const updatedRepos: RepoSyncConfig[] = [
        ...filteredRepos,
        {
          owner: input.repoOwner,
          name: input.repoName,
          webhookId,
          syncEnabled: true,
        },
      ]

      await prisma.connectedAccount.update({
        where: { id: account.id },
        data: { metadata: { ...metadata, repos: updatedRepos } },
      })

      logger.info('GitHub sync enabled', {
        userId: ctx.user.id,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        webhookId,
      })

      logAudit({
        userId: ctx.user.id,
        action: 'WEBHOOK_REGISTERED',
        resource: 'ConnectedAccount',
        resourceId: account.id,
        metadata: {
          repoOwner: input.repoOwner,
          repoName: input.repoName,
          webhookId,
        },
      })

      return { webhookId, syncEnabled: true }
    }),

  disableGitHubSync: protectedProcedure
    .input(
      z.object({
        repoOwner: z.string().min(1),
        repoName: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const account = await prisma.connectedAccount.findUnique({
        where: {
          userId_provider: {
            userId: ctx.user.id,
            provider: 'GITHUB',
          },
        },
      })

      if (!account) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No GitHub account connected.',
        })
      }

      const metadata = (account.metadata as ConnectedAccountMetadata | null) ?? {}
      const existingRepos = metadata.repos ?? []

      const repoConfig = existingRepos.find(
        (r) =>
          r.owner.toLowerCase() === input.repoOwner.toLowerCase() &&
          r.name.toLowerCase() === input.repoName.toLowerCase()
      )

      if (!repoConfig?.webhookId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No webhook found for this repository',
        })
      }

      await deleteWebhook(
        account.accessToken,
        input.repoOwner,
        input.repoName,
        repoConfig.webhookId
      )

      const updatedRepos = existingRepos.filter(
        (r) =>
          r.owner.toLowerCase() !== input.repoOwner.toLowerCase() ||
          r.name.toLowerCase() !== input.repoName.toLowerCase()
      )

      await prisma.connectedAccount.update({
        where: { id: account.id },
        data: { metadata: { ...metadata, repos: updatedRepos } },
      })

      logger.info('GitHub sync disabled', {
        userId: ctx.user.id,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
      })

      return { syncEnabled: false }
    }),

  listGoogleDriveFiles: protectedProcedure
    .input(z.object({ folderId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const { accessToken } = await getGoogleAccessToken(ctx.user.id)
      const files = await listGoogleDriveFiles(accessToken, input.folderId)

      return { files }
    }),

  scanGoogleDrive: protectedProcedure
    .input(z.object({ folderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { accessToken } = await getGoogleAccessToken(ctx.user.id)

      logger.info('Scanning Google Drive folder', {
        folderId: input.folderId,
        userId: ctx.user.id,
      })

      const scanResult = await scanGoogleDriveFolder(accessToken, input.folderId)

      const DETECTED_TYPE_SORT_ORDER: Record<DetectedFileType, number> = {
        AGENT_CONFIG: 0,
        SKILL: 1,
        PROMPT: 2,
        PLUGIN: 3,
        SCRIPT: 4,
      }

      const files: ScannedGoogleDriveFile[] = await Promise.all(
        scanResult.files.map(async (file) => {
          let preview: string | null = null

          try {
            const content = await fetchGoogleDriveFileContent(accessToken, file.fileId)
            preview = content.length > 500 ? `${content.slice(0, 500)}...` : content
          } catch {
            logger.warn('Failed to fetch Google Drive preview', { path: file.path })
          }

          return {
            path: file.path,
            name: file.name,
            type: file.type,
            detectedType: file.detectedType,
            agentId: file.agentId,
            fileId: file.fileId,
            preview,
          }
        })
      )

      files.sort(
        (a, b) =>
          (DETECTED_TYPE_SORT_ORDER[a.detectedType] ?? 99) -
          (DETECTED_TYPE_SORT_ORDER[b.detectedType] ?? 99)
      )

      return {
        folderId: input.folderId,
        files,
        skippedPaths: scanResult.skippedPaths,
      }
    }),

  importFromGoogleDrive: protectedProcedure
    .input(
      z.object({
        folderId: z.string(),
        organisationId: z.string(),
        adoptionMode: adoptionModeSchema,
        files: z.array(
          z.object({
            path: z.string(),
            name: z.string(),
            type: z.enum(['skill', 'config', 'rules']),
            detectedType: z.enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT']),
            agentId: z.string(),
            fileId: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.adoptionMode === 'MIRROR') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Mirror sync is not yet supported for Google Drive. Use Copy or Link mode instead.',
        })
      }

      const { accessToken } = await getGoogleAccessToken(ctx.user.id)
      const org = await validateOrgForAdoption(
        input.organisationId,
        ctx.user.id,
        input.adoptionMode
      )

      logger.info('Adopting files from Google Drive', {
        folderId: input.folderId,
        fileCount: input.files.length,
        adoptionMode: input.adoptionMode,
        userId: ctx.user.id,
      })

      const filesToAdopt: FileToAdopt[] = []
      const fetchErrors: Array<{ path: string; error: string }> = []

      for (const file of input.files) {
        try {
          const content = await fetchGoogleDriveFileContent(accessToken, file.fileId)
          filesToAdopt.push({
            path: file.path,
            name: file.name,
            content,
            detectedType: file.detectedType,
            agentId: file.agentId,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.error('Failed to fetch Google Drive file content', {
            path: file.path,
            error: message,
          })
          fetchErrors.push({ path: file.path, error: `Failed to fetch content: ${message}` })
        }
      }

      const adoptionCtx: AdoptionContext = {
        orgId: org.id,
        orgSlug: org.slug,
        userId: ctx.user.id,
        adoptionMode: input.adoptionMode,
        sourceProvider: 'google-drive',
        sourceUri: `gdrive://${input.folderId}`,
        skillsRepoProvider: org.skillsRepoProvider,
      }

      const { imported, errors } = await adoptFiles(adoptionCtx, filesToAdopt)

      logger.info('Google Drive adoption complete', {
        adopted: imported.length,
        failed: errors.length + fetchErrors.length,
      })

      logAudit({
        userId: ctx.user.id,
        action: 'IMPORT_COMPLETED',
        resource: 'Organisation',
        resourceId: input.organisationId,
        metadata: {
          source: 'google-drive',
          folderId: input.folderId,
          adoptionMode: input.adoptionMode,
          importedCount: imported.length,
          errorCount: errors.length + fetchErrors.length,
          organisationId: input.organisationId,
        },
      })

      return { imported, errors: [...fetchErrors, ...errors] }
    }),

  listOneDriveFiles: protectedProcedure
    .input(z.object({ folderId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const { accessToken } = await getMicrosoftAccessToken(ctx.user.id)
      const files = await listOneDriveFiles(accessToken, input.folderId)

      return { files }
    }),

  scanOneDrive: protectedProcedure
    .input(z.object({ folderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { accessToken } = await getMicrosoftAccessToken(ctx.user.id)

      logger.info('Scanning OneDrive folder', {
        folderId: input.folderId,
        userId: ctx.user.id,
      })

      const scanResult = await scanOneDriveFolder(accessToken, input.folderId)

      const DETECTED_TYPE_SORT_ORDER: Record<DetectedFileType, number> = {
        AGENT_CONFIG: 0,
        SKILL: 1,
        PROMPT: 2,
        PLUGIN: 3,
        SCRIPT: 4,
      }

      const files: ScannedOneDriveFileWithPreview[] = await Promise.all(
        scanResult.files.map(async (file) => {
          let preview: string | null = null

          try {
            const content = await fetchOneDriveFileContent(accessToken, file.itemId)
            preview = content.length > 500 ? `${content.slice(0, 500)}...` : content
          } catch {
            logger.warn('Failed to fetch OneDrive preview', { path: file.path })
          }

          return {
            path: file.path,
            name: file.name,
            type: file.type,
            detectedType: file.detectedType,
            agentId: file.agentId,
            itemId: file.itemId,
            preview,
          }
        })
      )

      files.sort(
        (a, b) =>
          (DETECTED_TYPE_SORT_ORDER[a.detectedType] ?? 99) -
          (DETECTED_TYPE_SORT_ORDER[b.detectedType] ?? 99)
      )

      return {
        folderId: input.folderId,
        files,
        skippedPaths: scanResult.skippedPaths,
      }
    }),

  importFromOneDrive: protectedProcedure
    .input(
      z.object({
        folderId: z.string(),
        organisationId: z.string(),
        adoptionMode: adoptionModeSchema,
        files: z.array(
          z.object({
            path: z.string(),
            name: z.string(),
            type: z.enum(['skill', 'config', 'rules']),
            detectedType: z.enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT']),
            agentId: z.string(),
            itemId: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.adoptionMode === 'MIRROR') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Mirror sync is not yet supported for OneDrive. Use Copy or Link mode instead.',
        })
      }

      const { accessToken } = await getMicrosoftAccessToken(ctx.user.id)
      const org = await validateOrgForAdoption(
        input.organisationId,
        ctx.user.id,
        input.adoptionMode
      )

      logger.info('Adopting files from OneDrive', {
        folderId: input.folderId,
        fileCount: input.files.length,
        adoptionMode: input.adoptionMode,
        userId: ctx.user.id,
      })

      const filesToAdopt: FileToAdopt[] = []
      const fetchErrors: Array<{ path: string; error: string }> = []

      for (const file of input.files) {
        try {
          const content = await fetchOneDriveFileContent(accessToken, file.itemId)
          filesToAdopt.push({
            path: file.path,
            name: file.name,
            content,
            detectedType: file.detectedType,
            agentId: file.agentId,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.error('Failed to fetch OneDrive file content', { path: file.path, error: message })
          fetchErrors.push({ path: file.path, error: `Failed to fetch content: ${message}` })
        }
      }

      const adoptionCtx: AdoptionContext = {
        orgId: org.id,
        orgSlug: org.slug,
        userId: ctx.user.id,
        adoptionMode: input.adoptionMode,
        sourceProvider: 'onedrive',
        sourceUri: `onedrive://${input.folderId}`,
        skillsRepoProvider: org.skillsRepoProvider,
      }

      const { imported, errors } = await adoptFiles(adoptionCtx, filesToAdopt)

      logger.info('OneDrive adoption complete', {
        adopted: imported.length,
        failed: errors.length + fetchErrors.length,
      })

      logAudit({
        userId: ctx.user.id,
        action: 'IMPORT_COMPLETED',
        resource: 'Organisation',
        resourceId: input.organisationId,
        metadata: {
          source: 'onedrive',
          folderId: input.folderId,
          adoptionMode: input.adoptionMode,
          importedCount: imported.length,
          errorCount: errors.length + fetchErrors.length,
          organisationId: input.organisationId,
        },
      })

      return { imported, errors: [...fetchErrors, ...errors] }
    }),
})
