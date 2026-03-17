import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { decryptToken, TokenDecryptionError } from '@/lib/crypto/token-encryption'
import { GitProviderConfigError, getGitProvider } from '@/lib/git'
import { validateRepoAccess } from '@/lib/github/skills-repo'
import { getGitHubToken } from '@/lib/github/token'
import { deleteWebhook } from '@/lib/import/github-webhook'
import { createNotification } from '@/lib/notifications'
import { deliverEvent } from '@/lib/webhooks/service'
import { protectedProcedure, router } from '../init'

const logger = createLogger('organisations-router')

type RepoSyncConfig = {
  owner: string
  name: string
  webhookId?: number
  syncEnabled?: boolean
}

type ConnectedAccountMetadata = {
  repos?: RepoSyncConfig[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertOrgRole(
  userId: string,
  organisationId: string,
  allowedRoles: Array<'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'>
) {
  const membership = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId, organisationId } },
  })

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' })
  }

  return membership
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const organisationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return prisma.organisation.findMany({
      where: { members: { some: { userId: ctx.user.id } } },
      select: {
        id: true,
        name: true,
        slug: true,
        image: true,
        createdAt: true,
        updatedAt: true,
        skillsRepoUrl: true,
        skillsRepoOwner: true,
        skillsRepoName: true,
        skillsRepoProvider: true,
        _count: { select: { members: true, packages: true } },
      },
      orderBy: { name: 'asc' },
    })
  }),

  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const org = await prisma.organisation.findUnique({
        where: { slug: input.slug },
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
            orderBy: { createdAt: 'asc' },
          },
          _count: { select: { packages: true, teams: true } },
        },
      })

      if (!org) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' })
      }

      const currentMember = org.members.find((m) => m.userId === ctx.user.id)
      if (!currentMember) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member' })
      }

      return {
        ...org,
        currentUserId: ctx.user.id,
        currentUserRole: currentMember.role,
      }
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        slug: z
          .string()
          .min(2)
          .max(50)
          .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.organisation.findUnique({ where: { slug: input.slug } })
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Slug already taken' })
      }

      const org = await prisma.organisation.create({
        data: {
          name: input.name,
          slug: input.slug,
          members: {
            create: { userId: ctx.user.id, role: 'OWNER' },
          },
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'ORG_CREATED',
        resource: 'Organisation',
        resourceId: org.id,
        metadata: { name: input.name, slug: input.slug },
      })

      return org
    }),

  update: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        name: z.string().min(1).max(100).optional(),
        image: z.string().url().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgRole(ctx.user.id, input.organisationId, ['OWNER', 'ADMIN'])

      const org = await prisma.organisation.update({
        where: { id: input.organisationId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.image !== undefined && { image: input.image }),
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'ORG_UPDATED',
        resource: 'Organisation',
        resourceId: org.id,
        metadata: { name: input.name, image: input.image },
      })

      return org
    }),

  delete: protectedProcedure
    .input(z.object({ organisationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertOrgRole(ctx.user.id, input.organisationId, ['OWNER'])

      const org = await prisma.organisation.findUnique({
        where: { id: input.organisationId },
        select: { name: true, slug: true },
      })

      await prisma.organisation.delete({ where: { id: input.organisationId } })

      logAudit({
        userId: ctx.user.id,
        action: 'ORG_DELETED',
        resource: 'Organisation',
        resourceId: input.organisationId,
        metadata: { name: org?.name, slug: org?.slug },
      })

      return { success: true }
    }),

  updateMemberRole: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        userId: z.string(),
        role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgRole(ctx.user.id, input.organisationId, ['OWNER', 'ADMIN'])

      const target = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: input.userId,
            organisationId: input.organisationId,
          },
        },
      })

      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' })
      }

      // Prevent demoting the last OWNER
      if (target.role === 'OWNER' && input.role !== 'OWNER') {
        const ownerCount = await prisma.organisationMember.count({
          where: { organisationId: input.organisationId, role: 'OWNER' },
        })
        if (ownerCount <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot demote the last owner. Promote another member to owner first.',
          })
        }
      }

      const updated = await prisma.organisationMember.update({
        where: {
          userId_organisationId: {
            userId: input.userId,
            organisationId: input.organisationId,
          },
        },
        data: { role: input.role },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'MEMBER_ROLE_UPDATED',
        resource: 'OrganisationMember',
        resourceId: updated.id,
        metadata: {
          targetUserId: input.userId,
          previousRole: target.role,
          newRole: input.role,
          organisationId: input.organisationId,
        },
      })

      return updated
    }),

  removeMember: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        userId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgRole(ctx.user.id, input.organisationId, ['OWNER', 'ADMIN'])

      const target = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: input.userId,
            organisationId: input.organisationId,
          },
        },
      })

      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' })
      }

      // Prevent removing the last OWNER
      if (target.role === 'OWNER') {
        const ownerCount = await prisma.organisationMember.count({
          where: { organisationId: input.organisationId, role: 'OWNER' },
        })
        if (ownerCount <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot remove the last owner.',
          })
        }
      }

      await prisma.organisationMember.delete({
        where: {
          userId_organisationId: {
            userId: input.userId,
            organisationId: input.organisationId,
          },
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'MEMBER_REMOVED',
        resource: 'OrganisationMember',
        resourceId: target.id,
        metadata: {
          removedUserId: input.userId,
          role: target.role,
          organisationId: input.organisationId,
        },
      })

      void deliverEvent(
        input.organisationId,
        'member.removed',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        { member: { userId: input.userId, role: target.role } }
      )

      return { success: true }
    }),

  invite: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        email: z.string().email(),
        role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const org = await prisma.organisation.findUnique({
        where: { id: input.organisationId },
        include: {
          members: {
            where: { userId: ctx.user.id, role: { in: ['OWNER', 'ADMIN'] } },
          },
        },
      })

      if (!org || org.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only owners/admins can invite' })
      }

      const invitee = await prisma.user.findUnique({ where: { email: input.email } })
      if (!invitee) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })
      }

      const existingMember = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: invitee.id,
            organisationId: input.organisationId,
          },
        },
      })

      if (existingMember) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This user is already a member of this organisation',
        })
      }

      const member = await prisma.organisationMember.create({
        data: {
          userId: invitee.id,
          organisationId: input.organisationId,
          role: input.role,
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'MEMBER_INVITED',
        resource: 'OrganisationMember',
        resourceId: member.id,
        metadata: {
          invitedUserId: invitee.id,
          email: input.email,
          role: input.role,
          organisationId: input.organisationId,
        },
      })

      // Notify the invited user
      const actorName = ctx.user.name ?? ctx.user.email
      createNotification(prisma, {
        userId: invitee.id,
        type: 'MEMBER_INVITED',
        title: `${actorName} invited you to ${org.name}`,
        body: `You've been added as a ${input.role.toLowerCase()} of ${org.name}`,
        resourceId: org.id,
        resourceType: 'organisation',
        actorId: ctx.user.id,
      })

      void deliverEvent(
        input.organisationId,
        'member.added',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        { member: { userId: invitee.id, email: input.email, role: input.role } }
      )

      return member
    }),

  connectSkillsRepo: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        useAgentverGit: z.boolean().default(false),
        url: z.string().url().optional(),
        owner: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        provider: z.string().default('github'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgRole(ctx.user.id, input.organisationId, ['OWNER', 'ADMIN'])

      // Agentver-hosted Forgejo path: create a namespace in Forgejo
      if (input.useAgentverGit) {
        const existingOrg = await prisma.organisation.findUnique({
          where: { id: input.organisationId },
          select: { slug: true, name: true },
        })

        if (!existingOrg) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' })
        }

        try {
          await getGitProvider().createNamespace(existingOrg.slug, existingOrg.name)
        } catch (error) {
          if (error instanceof GitProviderConfigError) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
          }
          logger.error('Failed to create Forgejo namespace', {
            slug: existingOrg.slug,
            error: error instanceof Error ? error.message : String(error),
          })
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to provision Agentver storage. Please try again later.',
          })
        }

        const org = await prisma.organisation.update({
          where: { id: input.organisationId },
          data: {
            skillsRepoUrl: `agentver://${existingOrg.slug}`,
            skillsRepoOwner: null,
            skillsRepoName: null,
            skillsRepoProvider: 'agentver',
          },
        })

        logAudit({
          userId: ctx.user.id,
          action: 'SKILLS_REPO_CONNECTED',
          resource: 'Organisation',
          resourceId: org.id,
          metadata: {
            url: `agentver://${existingOrg.slug}`,
            provider: 'agentver',
          },
        })

        return org
      }

      // External Git provider path (GitHub, etc.)
      if (!input.url || !input.owner || !input.name) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Repository URL, owner, and name are required when not using Agentver storage.',
        })
      }

      const token = await getGitHubToken(ctx.user.id)
      if (!token) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'No GitHub account connected. Please connect your GitHub account in Connections settings.',
        })
      }
      const hasAccess = await validateRepoAccess(input.owner, input.name, token)

      if (!hasAccess) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have push access to this repository. Please check permissions.',
        })
      }

      const org = await prisma.organisation.update({
        where: { id: input.organisationId },
        data: {
          skillsRepoUrl: input.url,
          skillsRepoOwner: input.owner,
          skillsRepoName: input.name,
          skillsRepoProvider: input.provider,
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'SKILLS_REPO_CONNECTED',
        resource: 'Organisation',
        resourceId: org.id,
        metadata: {
          url: input.url,
          owner: input.owner,
          name: input.name,
          provider: input.provider,
        },
      })

      return org
    }),

  disconnectSkillsRepo: protectedProcedure
    .input(z.object({ organisationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertOrgRole(ctx.user.id, input.organisationId, ['OWNER', 'ADMIN'])

      const existingOrg = await prisma.organisation.findUnique({
        where: { id: input.organisationId },
        select: {
          id: true,
          skillsRepoProvider: true,
          skillsRepoOwner: true,
          skillsRepoName: true,
        },
      })

      if (!existingOrg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' })
      }

      if (
        existingOrg.skillsRepoProvider === 'github' &&
        existingOrg.skillsRepoOwner &&
        existingOrg.skillsRepoName
      ) {
        const members = await prisma.organisationMember.findMany({
          where: { organisationId: existingOrg.id },
          select: { userId: true },
        })

        for (const member of members) {
          try {
            const account = await prisma.connectedAccount.findUnique({
              where: { userId_provider: { userId: member.userId, provider: 'GITHUB' } },
            })

            if (!account) continue

            const metadata = (account.metadata as ConnectedAccountMetadata | null) ?? {}
            const existingRepos = metadata.repos ?? []

            const repoConfig = existingRepos.find(
              (r) =>
                r.owner.toLowerCase() === existingOrg.skillsRepoOwner!.toLowerCase() &&
                r.name.toLowerCase() === existingOrg.skillsRepoName!.toLowerCase()
            )

            if (repoConfig?.webhookId) {
              let plainToken: string | null = null
              try {
                plainToken = decryptToken(account.accessToken)
              } catch (err) {
                if (!(err instanceof TokenDecryptionError)) throw err
                logger.warn('Could not decrypt token for webhook deletion, skipping', {
                  userId: member.userId,
                })
              }

              if (plainToken) {
                try {
                  await deleteWebhook(
                    plainToken,
                    existingOrg.skillsRepoOwner,
                    existingOrg.skillsRepoName,
                    repoConfig.webhookId
                  )
                } catch (err) {
                  logger.warn('Failed to delete GitHub webhook during skills repo disconnect', {
                    webhookId: repoConfig.webhookId,
                    repoOwner: existingOrg.skillsRepoOwner,
                    repoName: existingOrg.skillsRepoName,
                    userId: member.userId,
                    error: err instanceof Error ? err.message : String(err),
                  })
                }
              }
            }

            const updatedRepos = existingRepos.filter(
              (r) =>
                r.owner.toLowerCase() !== existingOrg.skillsRepoOwner!.toLowerCase() ||
                r.name.toLowerCase() !== existingOrg.skillsRepoName!.toLowerCase()
            )

            await prisma.connectedAccount.update({
              where: { id: account.id },
              data: { metadata: { ...metadata, repos: updatedRepos } },
            })
          } catch (err) {
            logger.warn('Failed to clean up webhook metadata for member during disconnect', {
              userId: member.userId,
              organisationId: existingOrg.id,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }
      }

      const org = await prisma.organisation.update({
        where: { id: input.organisationId },
        data: {
          skillsRepoUrl: null,
          skillsRepoOwner: null,
          skillsRepoName: null,
          skillsRepoProvider: null,
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'SKILLS_REPO_DISCONNECTED',
        resource: 'Organisation',
        resourceId: org.id,
        metadata: { organisationId: input.organisationId },
      })

      return org
    }),

  getSkillsRepoStatus: protectedProcedure
    .input(z.object({ organisationId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOrgRole(ctx.user.id, input.organisationId, ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'])

      const org = await prisma.organisation.findUnique({
        where: { id: input.organisationId },
        select: {
          skillsRepoUrl: true,
          skillsRepoOwner: true,
          skillsRepoName: true,
          skillsRepoProvider: true,
        },
      })

      if (!org) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' })
      }

      const isAgentver = org.skillsRepoProvider === 'agentver'
      const connected = isAgentver
        ? !!org.skillsRepoUrl
        : !!(org.skillsRepoUrl && org.skillsRepoOwner && org.skillsRepoName)

      return {
        connected,
        url: org.skillsRepoUrl,
        owner: org.skillsRepoOwner,
        name: org.skillsRepoName,
        provider: org.skillsRepoProvider,
      }
    }),
})
