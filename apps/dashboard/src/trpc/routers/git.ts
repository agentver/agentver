import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { GitProviderConfigError, getGitProvider } from '@/lib/git'
import { protectedProcedure, router } from '../init'

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
   * Get commit history for a skill from Forgejo.
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
    .query(async ({ input }) => {
      try {
        const gitService = getGitProvider()
        return gitService.getHistory(input.org, input.name, {
          limit: input.limit,
          ref: input.ref,
        })
      } catch (error) {
        if (error instanceof GitProviderConfigError) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
        }
        logger.error('Failed to fetch skill history', {
          org: input.org,
          name: input.name,
          error: error instanceof Error ? error.message : String(error),
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch commit history from Git',
        })
      }
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
})
