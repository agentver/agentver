import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { type CommitEntry, GitProviderConfigError, getGitProvider } from '@/lib/git'
import { deleteSkillFileFromGitHub } from '@/lib/github/skills-repo'
import { getGitHubToken } from '@/lib/github/token'
import { protectedProcedure, router } from '../init'

const GITHUB_API_BASE = 'https://api.github.com'

type GitHubCommitResponse = {
  sha: string
  commit: {
    message: string
    author: { name: string; email: string; date: string }
  }
}

/**
 * Fetch commit history for a path from the GitHub API.
 */
async function fetchGitHubCommitHistory(
  owner: string,
  repo: string,
  path: string,
  options: { limit: number; ref?: string },
  token: string
): Promise<CommitEntry[]> {
  const params = new URLSearchParams()
  params.set('path', path)
  params.set('per_page', String(options.limit))
  if (options.ref) params.set('sha', options.ref)

  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${params.toString()}`

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub API error (${response.status})`)
  }

  const commits = (await response.json()) as GitHubCommitResponse[]

  return commits.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author: {
      name: c.commit.author.name,
      email: c.commit.author.email,
      date: c.commit.author.date,
    },
    createdAt: c.commit.author.date,
  }))
}

const logger = createLogger('git-router')

export const gitRouter = router({
  /**
   * List all files within a skill directory from Forgejo.
   */
  getSkillFiles: protectedProcedure
    .input(
      z.object({
        org: z.string(),
        name: z.string(),
        ref: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const gitService = getGitProvider()
        return gitService.listSkillFiles(input.org, input.name, input.ref)
      } catch (error) {
        if (error instanceof GitProviderConfigError) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
        }
        logger.error('Failed to list skill files', {
          org: input.org,
          name: input.name,
          error: error instanceof Error ? error.message : String(error),
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list skill files from Git',
        })
      }
    }),

  /**
   * Retrieve the decoded content of a single file within a skill.
   */
  getSkillFileContent: protectedProcedure
    .input(
      z.object({
        org: z.string(),
        name: z.string(),
        path: z.string(),
        ref: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const gitService = getGitProvider()
        const content = await gitService.getSkillFile(input.org, input.name, input.path, input.ref)

        if (content === null) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `File not found: ${input.path}`,
          })
        }

        return { content, path: input.path }
      } catch (error) {
        if (error instanceof TRPCError) throw error
        if (error instanceof GitProviderConfigError) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
        }

        logger.error('Failed to fetch skill file content', {
          org: input.org,
          name: input.name,
          path: input.path,
          error: error instanceof Error ? error.message : String(error),
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch file content from Git',
        })
      }
    }),

  /**
   * Get commit history for a skill, routing to Forgejo or GitHub based on provider.
   */
  getSkillHistory: protectedProcedure
    .input(
      z.object({
        org: z.string(),
        name: z.string(),
        limit: z.number().min(1).max(100).default(20),
        ref: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const org = await prisma.organisation.findFirst({
        where: { slug: input.org },
        select: {
          skillsRepoProvider: true,
          skillsRepoOwner: true,
          skillsRepoName: true,
        },
      })

      if (!org) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' })
      }

      // Agentver-hosted Forgejo storage
      if (org.skillsRepoProvider === 'agentver') {
        try {
          const gitService = getGitProvider()
          return await gitService.getHistory(input.org, input.name, {
            limit: input.limit,
            ref: input.ref,
          })
        } catch (error) {
          if (error instanceof GitProviderConfigError) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
          }
          logger.error('Failed to fetch skill history from Forgejo', {
            org: input.org,
            name: input.name,
            error: error instanceof Error ? error.message : String(error),
          })
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to fetch commit history from Git',
          })
        }
      }

      // GitHub-backed storage
      if (org.skillsRepoProvider === 'github' && org.skillsRepoOwner && org.skillsRepoName) {
        const token = await getGitHubToken(ctx.user.id)
        if (!token) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'No connected GitHub account. Please connect your GitHub account in Settings.',
          })
        }

        try {
          const skillPath = `skills/${input.name}`
          return await fetchGitHubCommitHistory(
            org.skillsRepoOwner,
            org.skillsRepoName,
            skillPath,
            { limit: input.limit, ref: input.ref },
            token
          )
        } catch (error) {
          logger.error('Failed to fetch skill history from GitHub', {
            org: input.org,
            name: input.name,
            error: error instanceof Error ? error.message : String(error),
          })
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to fetch commit history from GitHub',
          })
        }
      }

      // No recognised provider — return empty history
      return []
    }),

  /**
   * List all draft branches in a namespace.
   */
  getSkillDrafts: protectedProcedure
    .input(z.object({ org: z.string() }))
    .query(async ({ input }) => {
      try {
        const gitService = getGitProvider()
        return gitService.listDrafts(input.org)
      } catch (error) {
        if (error instanceof GitProviderConfigError) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
        }
        logger.error('Failed to list skill drafts', {
          org: input.org,
          error: error instanceof Error ? error.message : String(error),
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list drafts from Git',
        })
      }
    }),

  /**
   * Get published versions from the database for a skill.
   */
  getSkillVersions: protectedProcedure
    .input(z.object({ org: z.string(), name: z.string() }))
    .query(async ({ input }) => {
      const pkg = await prisma.package.findFirst({
        where: {
          name: input.name,
          organisation: { slug: input.org },
        },
        select: { id: true },
      })

      if (!pkg) return []

      return prisma.packageVersion.findMany({
        where: { packageId: pkg.id },
        orderBy: { createdAt: 'desc' },
      })
    }),

  /**
   * Remove a single file from a skill directory.
   * Routes to Agentver Forgejo or GitHub based on the org's provider.
   */
  removeSkillFile: protectedProcedure
    .input(
      z.object({
        org: z.string(),
        name: z.string(),
        filePath: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const pkg = await prisma.package.findFirst({
        where: {
          name: input.name,
          organisation: { slug: input.org },
        },
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
          message: 'Only the package author or organisation admins can remove files',
        })
      }

      if (input.filePath === 'SKILL.md') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot remove the primary skill file (SKILL.md)',
        })
      }

      const org = pkg.organisation
      const message = `Remove ${input.filePath} from ${input.name}`

      // Agentver-hosted Forgejo storage
      if (org.skillsRepoProvider === 'agentver') {
        try {
          const gitService = getGitProvider()
          const result = await gitService.removeSkillFile(
            input.org,
            input.name,
            input.filePath,
            message
          )

          logger.info('Skill file removed via Forgejo', {
            org: input.org,
            name: input.name,
            filePath: input.filePath,
            commitSha: result.commitSha,
          })

          return { commitSha: result.commitSha }
        } catch (error) {
          if (error instanceof GitProviderConfigError) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
          }
          logger.error('Failed to remove skill file from Forgejo', {
            org: input.org,
            name: input.name,
            filePath: input.filePath,
            error: error instanceof Error ? error.message : String(error),
          })
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to remove file from Git',
          })
        }
      }

      // GitHub-backed storage
      if (org.skillsRepoProvider === 'github' && org.skillsRepoOwner && org.skillsRepoName) {
        const token = await getGitHubToken(ctx.user.id)
        if (!token) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'No connected GitHub account. Please connect your GitHub account in Settings.',
          })
        }

        try {
          const skillFilePath = `skills/${input.name}/${input.filePath}`
          const result = await deleteSkillFileFromGitHub(
            org.skillsRepoOwner,
            org.skillsRepoName,
            skillFilePath,
            message,
            token
          )

          logger.info('Skill file removed via GitHub', {
            org: input.org,
            name: input.name,
            filePath: input.filePath,
            commitSha: result.commitSha,
          })

          return { commitSha: result.commitSha }
        } catch (error) {
          logger.error('Failed to remove skill file from GitHub', {
            org: input.org,
            name: input.name,
            filePath: input.filePath,
            error: error instanceof Error ? error.message : String(error),
          })
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to remove file from GitHub',
          })
        }
      }

      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'No skills repository configured for this organisation',
      })
    }),
})
