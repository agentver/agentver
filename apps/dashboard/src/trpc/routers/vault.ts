import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { decryptToken, encryptToken, TokenDecryptionError } from '@/lib/crypto/token-encryption'
import { protectedProcedure, router } from '../init'

const logger = createLogger('vault-router')

const secretSharingSchema = z.enum(['INDIVIDUAL', 'TEAM', 'ORG'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireOrgMembership(userId: string, organisationId: string) {
  const membership = await prisma.organisationMember.findUnique({
    where: {
      userId_organisationId: { userId, organisationId },
    },
  })

  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' })
  }

  return membership
}

async function requireOrgAdminOrOwner(userId: string, organisationId: string) {
  const membership = await requireOrgMembership(userId, organisationId)

  if (!(['OWNER', 'ADMIN'] as const).includes(membership.role as 'OWNER' | 'ADMIN')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only owners and admins can manage vault secrets',
    })
  }

  return membership
}

async function requireTeamMembership(userId: string, teamId: string) {
  const teamMember = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  })

  if (!teamMember) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this team' })
  }

  return teamMember
}

function logSecretAccess(secretId: string, userId: string, action: string) {
  prisma.secretAccessLog
    .create({
      data: { secretId, userId, action },
    })
    .catch((error: unknown) => {
      logger.error('Failed to write secret access log', {
        secretId,
        action,
        error: error instanceof Error ? error.message : String(error),
      })
    })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const vaultRouter = router({
  /**
   * List secrets visible to the current user within an organisation.
   * Returns metadata only — never the encrypted values.
   */
  list: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        teamId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireOrgMembership(ctx.user.id, input.organisationId)

      const where: Record<string, unknown> = {
        organisationId: input.organisationId,
      }

      if (input.teamId) {
        await requireTeamMembership(ctx.user.id, input.teamId)
        where.teamId = input.teamId
      }

      const secrets = await prisma.secretVault.findMany({
        where,
        select: {
          id: true,
          key: true,
          description: true,
          sharing: true,
          rotationDays: true,
          lastRotatedAt: true,
          expiresAt: true,
          createdById: true,
          teamId: true,
          createdAt: true,
          updatedAt: true,
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { key: 'asc' },
      })

      return secrets.map((secret) => ({
        ...secret,
        isExpired: secret.expiresAt ? secret.expiresAt < new Date() : false,
        isRotationDue:
          secret.rotationDays && secret.lastRotatedAt
            ? Date.now() - secret.lastRotatedAt.getTime() >
              secret.rotationDays * 24 * 60 * 60 * 1000
            : false,
      }))
    }),

  /**
   * Create or update a secret in the vault.
   * Only org admins/owners can create org-level secrets.
   * Team secrets require team membership + org admin/owner.
   */
  set: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        teamId: z.string().nullish(),
        key: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[a-z0-9-]+$/, 'Key must be lowercase alphanumeric with hyphens'),
        description: z.string().max(500),
        value: z.string().min(1).max(10_000),
        sharing: secretSharingSchema.default('INDIVIDUAL'),
        rotationDays: z.number().int().positive().max(365).optional(),
        expiresAt: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdminOrOwner(ctx.user.id, input.organisationId)

      if (input.teamId) {
        const team = await prisma.team.findUnique({
          where: { id: input.teamId },
          select: { organisationId: true },
        })

        if (!team || team.organisationId !== input.organisationId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Team does not belong to this organisation',
          })
        }
      }

      const encryptedValue = encryptToken(input.value)

      const secret = await prisma.secretVault.upsert({
        where: {
          organisationId_teamId_key: {
            organisationId: input.organisationId,
            teamId: input.teamId ?? '',
            key: input.key,
          },
        },
        create: {
          organisationId: input.organisationId,
          teamId: input.teamId ?? null,
          key: input.key,
          description: input.description,
          encryptedValue,
          sharing: input.sharing,
          rotationDays: input.rotationDays,
          lastRotatedAt: new Date(),
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          createdById: ctx.user.id,
        },
        update: {
          description: input.description,
          encryptedValue,
          sharing: input.sharing,
          rotationDays: input.rotationDays,
          lastRotatedAt: new Date(),
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
        select: {
          id: true,
          key: true,
          description: true,
          sharing: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      logSecretAccess(secret.id, ctx.user.id, 'write')

      logAudit({
        userId: ctx.user.id,
        action: 'SECRET_CREATED',
        resource: 'SecretVault',
        resourceId: secret.id,
        metadata: {
          key: input.key,
          organisationId: input.organisationId,
          teamId: input.teamId,
          sharing: input.sharing,
        },
      })

      logger.info('Secret stored in vault', {
        userId: ctx.user.id,
        secretKey: input.key,
        organisationId: input.organisationId,
      })

      return secret
    }),

  /**
   * Retrieve a secret value from the vault.
   * Access is controlled by sharing mode:
   * - ORG: any org member can read
   * - TEAM: only team members can read
   * - INDIVIDUAL: only the creator can read
   */
  get: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        key: z.string(),
        teamId: z.string().nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgMembership(ctx.user.id, input.organisationId)

      const secret = await prisma.secretVault.findUnique({
        where: {
          organisationId_teamId_key: {
            organisationId: input.organisationId,
            teamId: input.teamId ?? '',
            key: input.key,
          },
        },
      })

      if (!secret) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Secret "${input.key}" not found` })
      }

      // Enforce sharing mode access control
      switch (secret.sharing) {
        case 'INDIVIDUAL':
          if (secret.createdById !== ctx.user.id) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'This secret is only accessible by its creator',
            })
          }
          break

        case 'TEAM':
          if (secret.teamId) {
            await requireTeamMembership(ctx.user.id, secret.teamId)
          }
          break

        case 'ORG':
          // Already verified org membership above
          break
      }

      // Check expiry
      if (secret.expiresAt && secret.expiresAt < new Date()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This secret has expired and must be rotated',
        })
      }

      let value: string
      try {
        value = decryptToken(secret.encryptedValue)
      } catch (error) {
        if (error instanceof TokenDecryptionError) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to decrypt secret — the encryption key may have changed',
          })
        }
        throw error
      }

      logSecretAccess(secret.id, ctx.user.id, 'read')

      logger.info('Secret retrieved from vault', {
        userId: ctx.user.id,
        secretKey: input.key,
        organisationId: input.organisationId,
      })

      return { key: secret.key, value }
    }),

  /**
   * Rotate a secret — updates the encrypted value and resets the rotation timer.
   */
  rotate: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        key: z.string(),
        teamId: z.string().nullish(),
        newValue: z.string().min(1).max(10_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgAdminOrOwner(ctx.user.id, input.organisationId)

      const secret = await prisma.secretVault.findUnique({
        where: {
          organisationId_teamId_key: {
            organisationId: input.organisationId,
            teamId: input.teamId ?? '',
            key: input.key,
          },
        },
      })

      if (!secret) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Secret "${input.key}" not found` })
      }

      const encryptedValue = encryptToken(input.newValue)

      const updated = await prisma.secretVault.update({
        where: { id: secret.id },
        data: {
          encryptedValue,
          lastRotatedAt: new Date(),
        },
        select: {
          id: true,
          key: true,
          lastRotatedAt: true,
          updatedAt: true,
        },
      })

      logSecretAccess(secret.id, ctx.user.id, 'rotate')

      logAudit({
        userId: ctx.user.id,
        action: 'SECRET_ROTATED',
        resource: 'SecretVault',
        resourceId: secret.id,
        metadata: { key: input.key, organisationId: input.organisationId },
      })

      logger.info('Secret rotated', {
        userId: ctx.user.id,
        secretKey: input.key,
        organisationId: input.organisationId,
      })

      return updated
    }),

  /**
   * Delete a secret from the vault. Only org owners can delete.
   */
  delete: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        key: z.string(),
        teamId: z.string().nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMembership(ctx.user.id, input.organisationId)

      if (membership.role !== 'OWNER') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only organisation owners can delete vault secrets',
        })
      }

      const secret = await prisma.secretVault.findUnique({
        where: {
          organisationId_teamId_key: {
            organisationId: input.organisationId,
            teamId: input.teamId ?? '',
            key: input.key,
          },
        },
      })

      if (!secret) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Secret "${input.key}" not found` })
      }

      logSecretAccess(secret.id, ctx.user.id, 'delete')

      await prisma.secretVault.delete({ where: { id: secret.id } })

      logAudit({
        userId: ctx.user.id,
        action: 'SECRET_DELETED',
        resource: 'SecretVault',
        resourceId: secret.id,
        metadata: { key: input.key, organisationId: input.organisationId },
      })

      logger.info('Secret deleted from vault', {
        userId: ctx.user.id,
        secretKey: input.key,
        organisationId: input.organisationId,
      })

      return { success: true }
    }),

  /**
   * List access logs for a specific secret. Admin/owner only.
   */
  accessLogs: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        secretId: z.string(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireOrgAdminOrOwner(ctx.user.id, input.organisationId)

      const secret = await prisma.secretVault.findUnique({
        where: { id: input.secretId },
        select: { organisationId: true },
      })

      if (!secret || secret.organisationId !== input.organisationId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Secret not found' })
      }

      const logs = await prisma.secretAccessLog.findMany({
        where: { secretId: input.secretId },
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: { createdAt: 'desc' },
      })

      const hasMore = logs.length > input.limit
      const items = hasMore ? logs.slice(0, -1) : logs

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
      }
    }),

  /**
   * Bulk retrieve multiple secrets for bundle installation.
   * Returns only the keys the user has access to.
   */
  getBulk: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        teamId: z.string().nullish(),
        keys: z.array(z.string()).min(1).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrgMembership(ctx.user.id, input.organisationId)

      const secrets = await prisma.secretVault.findMany({
        where: {
          organisationId: input.organisationId,
          key: { in: input.keys },
          OR: [{ teamId: input.teamId ?? null }, { teamId: null }],
        },
      })

      const results: Array<{ key: string; value: string }> = []
      const denied: string[] = []

      for (const secret of secrets) {
        // Check sharing access
        let hasAccess = false

        switch (secret.sharing) {
          case 'INDIVIDUAL':
            hasAccess = secret.createdById === ctx.user.id
            break

          case 'TEAM':
            if (secret.teamId) {
              const teamMember = await prisma.teamMember.findUnique({
                where: { teamId_userId: { teamId: secret.teamId, userId: ctx.user.id } },
              })
              hasAccess = !!teamMember
            } else {
              hasAccess = true
            }
            break

          case 'ORG':
            hasAccess = true
            break
        }

        if (!hasAccess) {
          denied.push(secret.key)
          continue
        }

        // Check expiry
        if (secret.expiresAt && secret.expiresAt < new Date()) {
          denied.push(secret.key)
          continue
        }

        try {
          const value = decryptToken(secret.encryptedValue)
          results.push({ key: secret.key, value })
          logSecretAccess(secret.id, ctx.user.id, 'read')
        } catch {
          denied.push(secret.key)
        }
      }

      const missing = input.keys.filter(
        (k) => !results.some((r) => r.key === k) && !denied.includes(k)
      )

      return { secrets: results, denied, missing }
    }),
})
