import { randomBytes } from 'node:crypto'
import { prisma } from '@agentver/database'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { WEBHOOK_EVENTS } from '@/lib/webhooks/service'
import { protectedProcedure, router } from '../init'

const webhookEventSchema = z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]])

export const webhooksRouter = router({
  list: protectedProcedure
    .input(z.object({ organisationId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOrgMember(ctx.user.id, input.organisationId)

      return prisma.webhookEndpoint.findMany({
        where: { organisationId: input.organisationId },
        select: {
          id: true,
          url: true,
          events: true,
          active: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { deliveries: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    }),

  create: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        url: z.string().url(),
        events: z.array(webhookEventSchema).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgMember(ctx.user.id, input.organisationId)

      const secret = randomBytes(32).toString('hex')

      const endpoint = await prisma.webhookEndpoint.create({
        data: {
          organisationId: input.organisationId,
          url: input.url,
          secret,
          events: input.events,
        },
      })

      return { id: endpoint.id, secret }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        url: z.string().url().optional(),
        events: z.array(webhookEventSchema).min(1).optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const endpoint = await prisma.webhookEndpoint.findUnique({
        where: { id: input.id },
        select: { organisationId: true },
      })

      if (!endpoint) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Webhook endpoint not found' })
      }

      await assertOrgMember(ctx.user.id, endpoint.organisationId)

      return prisma.webhookEndpoint.update({
        where: { id: input.id },
        data: {
          ...(input.url !== undefined && { url: input.url }),
          ...(input.events !== undefined && { events: input.events }),
          ...(input.active !== undefined && { active: input.active }),
        },
      })
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const endpoint = await prisma.webhookEndpoint.findUnique({
        where: { id: input.id },
        select: { organisationId: true },
      })

      if (!endpoint) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Webhook endpoint not found' })
      }

      await assertOrgMember(ctx.user.id, endpoint.organisationId)

      await prisma.webhookEndpoint.delete({ where: { id: input.id } })

      return { success: true }
    }),

  deliveries: protectedProcedure
    .input(
      z.object({
        endpointId: z.string(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const endpoint = await prisma.webhookEndpoint.findUnique({
        where: { id: input.endpointId },
        select: { organisationId: true },
      })

      if (!endpoint) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Webhook endpoint not found' })
      }

      await assertOrgMember(ctx.user.id, endpoint.organisationId)

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { endpointId: input.endpointId },
        orderBy: { createdAt: 'desc' },
        take: input.limit + 1,
        ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
      })

      const hasMore = deliveries.length > input.limit
      const items = hasMore ? deliveries.slice(0, input.limit) : deliveries

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
      }
    }),

  rotateSecret: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const endpoint = await prisma.webhookEndpoint.findUnique({
        where: { id: input.id },
        select: { organisationId: true },
      })

      if (!endpoint) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Webhook endpoint not found' })
      }

      await assertOrgMember(ctx.user.id, endpoint.organisationId)

      const secret = randomBytes(32).toString('hex')

      await prisma.webhookEndpoint.update({
        where: { id: input.id },
        data: { secret },
      })

      return { secret }
    }),
})

async function assertOrgMember(userId: string, organisationId: string): Promise<void> {
  const membership = await prisma.organisationMember.findFirst({
    where: { userId, organisationId },
    select: { id: true },
  })

  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' })
  }
}
