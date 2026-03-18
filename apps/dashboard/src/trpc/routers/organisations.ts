import { randomUUID } from 'node:crypto'
import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { decryptToken, TokenDecryptionError } from '@/lib/crypto/token-encryption'
import { getEmailProvider } from '@/lib/email'
import { buildInvitationEmail } from '@/lib/email/templates/invitation'
import { GitProviderConfigError, getGitProvider } from '@/lib/git'
import { validateRepoAccess } from '@/lib/github/skills-repo'
import { getGitHubToken } from '@/lib/github/token'
import { deleteWebhook } from '@/lib/import/github-webhook'
import { createNotification } from '@/lib/notifications'
import { deliverEvent } from '@/lib/webhooks/service'
import { protectedProcedure, publicProcedure, router } from '../init'

const logger = createLogger('organisations-router')

const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const RESEND_COOLDOWN_MS = 10 * 60 * 1000 // 10 minutes

function buildAcceptUrl(token: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  return `${baseUrl}/invitations/${token}`
}

async function sendInvitationEmail(
  email: string,
  token: string,
  inviterName: string,
  organisationName: string,
  role: string,
  expiresAt: Date
): Promise<void> {
  try {
    const emailMessage = buildInvitationEmail({
      recipientEmail: email,
      inviterName,
      organisationName,
      role,
      acceptUrl: buildAcceptUrl(token),
      expiresAt,
    })
    await getEmailProvider().send(emailMessage)
  } catch (error) {
    logger.error('Failed to send invitation email', {
      email,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

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
      // Rate limit: max 5 orgs where user is OWNER
      const userOrgCount = await prisma.organisationMember.count({
        where: { userId: ctx.user.id, role: 'OWNER' },
      })
      if (userOrgCount >= 5) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message:
            'You have reached the maximum of 5 organisations. Please delete an existing organisation before creating a new one.',
        })
      }

      // Rate limit: max 3 org creations per hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      const recentOrgCount = await prisma.organisation.count({
        where: {
          members: { some: { userId: ctx.user.id, role: 'OWNER' } },
          createdAt: { gt: oneHourAgo },
        },
      })
      if (recentOrgCount >= 3) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message:
            'You have created too many organisations recently. Please wait before creating another.',
        })
      }

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

  sendInvitation: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        email: z.string().email(),
        role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgRole(ctx.user.id, input.organisationId, ['OWNER', 'ADMIN'])

      const org = await prisma.organisation.findUnique({
        where: { id: input.organisationId },
        select: { id: true, name: true },
      })

      if (!org) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' })
      }

      // Check if the email already belongs to an existing member
      const existingUser = await prisma.user.findUnique({ where: { email: input.email } })
      if (existingUser) {
        const existingMember = await prisma.organisationMember.findUnique({
          where: {
            userId_organisationId: {
              userId: existingUser.id,
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
      }

      // Check for existing pending invitation
      const existingInvite = await prisma.organisationInvitation.findUnique({
        where: {
          organisationId_email: {
            organisationId: input.organisationId,
            email: input.email,
          },
        },
      })

      if (
        existingInvite &&
        !existingInvite.acceptedAt &&
        !existingInvite.declinedAt &&
        existingInvite.expiresAt > new Date()
      ) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'An invitation is already pending for this email',
        })
      }

      const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS)

      // Upsert: replace any expired/declined invitation for this email
      const invitation = await prisma.organisationInvitation.upsert({
        where: {
          organisationId_email: {
            organisationId: input.organisationId,
            email: input.email,
          },
        },
        create: {
          organisationId: input.organisationId,
          email: input.email,
          role: input.role,
          invitedById: ctx.user.id,
          expiresAt,
        },
        update: {
          role: input.role,
          invitedById: ctx.user.id,
          expiresAt,
          acceptedAt: null,
          declinedAt: null,
          token: randomUUID(),
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'INVITATION_SENT',
        resource: 'OrganisationInvitation',
        resourceId: invitation.id,
        metadata: {
          email: input.email,
          role: input.role,
          organisationId: input.organisationId,
        },
      })

      const inviterName = ctx.user.name ?? ctx.user.email
      void sendInvitationEmail(
        input.email,
        invitation.token,
        inviterName,
        org.name,
        input.role,
        expiresAt
      )

      // If the user already exists, also send an in-app notification
      if (existingUser) {
        createNotification(prisma, {
          userId: existingUser.id,
          type: 'MEMBER_INVITED',
          title: `${inviterName} invited you to ${org.name}`,
          body: `You've been invited as a ${input.role.toLowerCase()} of ${org.name}`,
          resourceId: org.id,
          resourceType: 'organisation',
          actorId: ctx.user.id,
        })
      }

      return invitation
    }),

  listInvitations: protectedProcedure
    .input(z.object({ organisationId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOrgRole(ctx.user.id, input.organisationId, ['OWNER', 'ADMIN'])

      return prisma.organisationInvitation.findMany({
        where: {
          organisationId: input.organisationId,
          acceptedAt: null,
          declinedAt: null,
        },
        include: {
          invitedBy: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    }),

  cancelInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await prisma.organisationInvitation.findUnique({
        where: { id: input.invitationId },
      })

      if (!invitation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found' })
      }

      await assertOrgRole(ctx.user.id, invitation.organisationId, ['OWNER', 'ADMIN'])

      if (invitation.acceptedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot cancel an already accepted invitation',
        })
      }

      await prisma.organisationInvitation.delete({
        where: { id: input.invitationId },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'INVITATION_CANCELLED',
        resource: 'OrganisationInvitation',
        resourceId: input.invitationId,
        metadata: {
          email: invitation.email,
          organisationId: invitation.organisationId,
        },
      })

      return { success: true }
    }),

  resendInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await prisma.organisationInvitation.findUnique({
        where: { id: input.invitationId },
        include: { organisation: { select: { name: true } } },
      })

      if (!invitation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found' })
      }

      await assertOrgRole(ctx.user.id, invitation.organisationId, ['OWNER', 'ADMIN'])

      if (invitation.acceptedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot resend an already accepted invitation',
        })
      }

      // Enforce resend cooldown
      const timeSinceCreated = Date.now() - invitation.createdAt.getTime()
      if (timeSinceCreated < RESEND_COOLDOWN_MS) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Please wait before resending this invitation',
        })
      }

      const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS)

      const updated = await prisma.organisationInvitation.update({
        where: { id: input.invitationId },
        data: {
          token: randomUUID(),
          expiresAt,
          createdAt: new Date(), // Reset createdAt for cooldown tracking
        },
      })

      const inviterName = ctx.user.name ?? ctx.user.email
      void sendInvitationEmail(
        invitation.email,
        updated.token,
        inviterName,
        invitation.organisation.name,
        invitation.role,
        expiresAt
      )

      logAudit({
        userId: ctx.user.id,
        action: 'INVITATION_RESENT',
        resource: 'OrganisationInvitation',
        resourceId: input.invitationId,
        metadata: {
          email: invitation.email,
          organisationId: invitation.organisationId,
        },
      })

      return updated
    }),

  acceptInvitation: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await prisma.organisationInvitation.findUnique({
        where: { token: input.token },
        include: { organisation: { select: { id: true, name: true, slug: true } } },
      })

      if (!invitation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invalid or expired invitation' })
      }

      if (invitation.acceptedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This invitation has already been accepted',
        })
      }

      if (invitation.declinedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This invitation has been declined',
        })
      }

      if (invitation.expiresAt < new Date()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This invitation has expired' })
      }

      // If the user is not authenticated, return invitation details for the UI
      // to prompt sign-in/sign-up
      if (!ctx.user) {
        return {
          organisation: invitation.organisation,
          email: invitation.email,
          role: invitation.role,
          requiresAuth: true as const,
        }
      }

      // Verify the authenticated user's email matches the invitation
      if (ctx.user.email !== invitation.email) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This invitation was sent to a different email address',
        })
      }

      // Check if already a member
      const existingMember = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: ctx.user.id,
            organisationId: invitation.organisationId,
          },
        },
      })

      if (existingMember) {
        // Mark as accepted even if already a member
        await prisma.organisationInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        })
        return {
          organisation: invitation.organisation,
          email: invitation.email,
          role: invitation.role,
          requiresAuth: false as const,
          alreadyMember: true as const,
        }
      }

      // Create membership and mark invitation as accepted in a transaction
      await prisma.$transaction([
        prisma.organisationMember.create({
          data: {
            userId: ctx.user.id,
            organisationId: invitation.organisationId,
            role: invitation.role,
          },
        }),
        prisma.organisationInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        }),
      ])

      logAudit({
        userId: ctx.user.id,
        action: 'INVITATION_ACCEPTED',
        resource: 'OrganisationInvitation',
        resourceId: invitation.id,
        metadata: {
          email: invitation.email,
          role: invitation.role,
          organisationId: invitation.organisationId,
        },
      })

      void deliverEvent(
        invitation.organisationId,
        'member.added',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        { member: { userId: ctx.user.id, email: invitation.email, role: invitation.role } }
      )

      return {
        organisation: invitation.organisation,
        email: invitation.email,
        role: invitation.role,
        requiresAuth: false as const,
        alreadyMember: false as const,
      }
    }),

  leave: protectedProcedure
    .input(z.object({ organisationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: ctx.user.id,
            organisationId: input.organisationId,
          },
        },
      })

      if (!membership) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'You are not a member of this organisation',
        })
      }

      if (membership.role === 'OWNER') {
        const ownerCount = await prisma.organisationMember.count({
          where: { organisationId: input.organisationId, role: 'OWNER' },
        })
        if (ownerCount <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'You are the only owner of this organisation. Transfer ownership to another member before leaving.',
          })
        }
      }

      await prisma.organisationMember.delete({
        where: {
          userId_organisationId: {
            userId: ctx.user.id,
            organisationId: input.organisationId,
          },
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'MEMBER_LEFT',
        resource: 'OrganisationMember',
        resourceId: membership.id,
        metadata: {
          role: membership.role,
          organisationId: input.organisationId,
        },
      })

      void deliverEvent(
        input.organisationId,
        'member.removed',
        { id: ctx.user.id, username: ctx.user.name ?? ctx.user.email },
        { member: { userId: ctx.user.id, role: membership.role, selfRemoved: true } }
      )

      return { success: true }
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
