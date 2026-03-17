import { prisma } from '@agentver/database'
import { z } from 'zod'
import { protectedProcedure, router } from '../init'

export const notificationsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        unreadOnly: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = {
        userId: ctx.user.id,
        ...(input.unreadOnly && { read: false }),
      }

      const [notifications, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: input.limit,
          skip: input.offset,
        }),
        prisma.notification.count({ where }),
      ])

      return { notifications, total }
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const count = await prisma.notification.count({
      where: { userId: ctx.user.id, read: false },
    })

    return { count }
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.notification.updateMany({
        where: { id: input.id, userId: ctx.user.id },
        data: { read: true },
      })

      return { success: true }
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await prisma.notification.updateMany({
      where: { userId: ctx.user.id, read: false },
      data: { read: true },
    })

    return { success: true }
  }),

  deleteOld: protectedProcedure.mutation(async ({ ctx }) => {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const result = await prisma.notification.deleteMany({
      where: {
        userId: ctx.user.id,
        createdAt: { lt: thirtyDaysAgo },
      },
    })

    return { deleted: result.count }
  }),
})
