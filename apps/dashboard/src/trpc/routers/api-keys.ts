import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@agentver/database'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { protectedProcedure, router } from '../init'

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export const apiKeysRouter = router({
  list: protectedProcedure
    .input(z.object({ organisationId: z.string() }))
    .query(async ({ ctx, input }) => {
      return prisma.apiKey.findMany({
        where: { organisationId: input.organisationId, userId: ctx.user.id },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          scopes: true,
          expiresAt: true,
          lastUsedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      })
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        organisationId: z.string(),
        scopes: z.array(z.enum(['READ', 'WRITE', 'ADMIN'])).min(1),
        expiresAt: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const org = await prisma.organisation.findUnique({
        where: { id: input.organisationId },
        include: { members: { where: { userId: ctx.user.id } } },
      })

      if (!org || org.members.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' })
      }

      const rawKey = `av_${randomBytes(32).toString('hex')}`
      const keyHash = hashApiKey(rawKey)
      const keyPrefix = rawKey.slice(0, 10)

      const created = await prisma.apiKey.create({
        data: {
          name: input.name,
          keyHash,
          keyPrefix,
          scopes: input.scopes,
          userId: ctx.user.id,
          organisationId: input.organisationId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'API_KEY_CREATED',
        resource: 'ApiKey',
        resourceId: created.id,
        metadata: { name: input.name, scopes: input.scopes, organisationId: input.organisationId },
      })

      return { key: rawKey }
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const apiKey = await prisma.apiKey.findUnique({ where: { id: input.id } })

      if (!apiKey || apiKey.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'API key not found' })
      }

      await prisma.apiKey.delete({ where: { id: input.id } })

      logAudit({
        userId: ctx.user.id,
        action: 'API_KEY_REVOKED',
        resource: 'ApiKey',
        resourceId: input.id,
        metadata: { name: apiKey.name, keyPrefix: apiKey.keyPrefix },
      })

      return { success: true }
    }),
})
