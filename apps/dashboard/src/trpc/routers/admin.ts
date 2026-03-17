import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { env } from '@/lib/env'
import { protectedProcedure, router } from '../init'

const logger = createLogger('admin-router')

function getAdminEmails(): string[] {
  const raw = env.PLATFORM_ADMIN_EMAILS
  if (!raw) return []
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const adminEmails = getAdminEmails()

  if (adminEmails.length === 0) {
    logger.warn('Admin access attempted but PLATFORM_ADMIN_EMAILS is not configured')
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access is not configured' })
  }

  if (!adminEmails.includes(ctx.user.email.toLowerCase())) {
    logger.warn('Unauthorised admin access attempt', { userId: ctx.user.id, email: ctx.user.email })
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have platform admin access' })
  }

  return next({ ctx })
})

const paginationInput = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
})

export const adminRouter = router({
  listUsers: adminProcedure.input(paginationInput).query(async ({ input }) => {
    const { page, perPage, search } = input
    const skip = (page - 1) * perPage

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
            { username: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          username: true,
          image: true,
          suspended: true,
          suspendedAt: true,
          createdAt: true,
          _count: { select: { memberships: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
      }),
      prisma.user.count({ where }),
    ])

    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        username: u.username,
        image: u.image,
        suspended: u.suspended,
        suspendedAt: u.suspendedAt,
        createdAt: u.createdAt,
        orgCount: u._count.memberships,
      })),
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    }
  }),

  listOrganisations: adminProcedure.input(paginationInput).query(async ({ input }) => {
    const { page, perPage, search } = input
    const skip = (page - 1) * perPage

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { slug: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}

    const [organisations, total] = await Promise.all([
      prisma.organisation.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          image: true,
          createdAt: true,
          _count: { select: { members: true, packages: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
      }),
      prisma.organisation.count({ where }),
    ])

    return {
      organisations: organisations.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        image: o.image,
        createdAt: o.createdAt,
        memberCount: o._count.members,
        packageCount: o._count.packages,
      })),
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    }
  }),

  getStats: adminProcedure.query(async () => {
    const [totalUsers, totalOrganisations, totalPackages, totalSkills] = await Promise.all([
      prisma.user.count(),
      prisma.organisation.count(),
      prisma.package.count(),
      prisma.package.count({ where: { type: 'SKILL' } }),
    ])

    return { totalUsers, totalOrganisations, totalPackages, totalSkills }
  }),

  suspendUser: adminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const target = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true, suspended: true },
      })

      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })
      }

      if (target.suspended) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'User is already suspended' })
      }

      if (target.email.toLowerCase() === ctx.user.email.toLowerCase()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot suspend yourself' })
      }

      await prisma.user.update({
        where: { id: input.userId },
        data: { suspended: true, suspendedAt: new Date() },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'USER_SUSPENDED',
        resource: 'User',
        resourceId: input.userId,
        metadata: { targetEmail: target.email },
      })

      logger.info('User suspended', { adminId: ctx.user.id, targetId: input.userId })

      return { success: true }
    }),

  unsuspendUser: adminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const target = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true, suspended: true },
      })

      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })
      }

      if (!target.suspended) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'User is not suspended' })
      }

      await prisma.user.update({
        where: { id: input.userId },
        data: { suspended: false, suspendedAt: null },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'USER_UNSUSPENDED',
        resource: 'User',
        resourceId: input.userId,
        metadata: { targetEmail: target.email },
      })

      logger.info('User unsuspended', { adminId: ctx.user.id, targetId: input.userId })

      return { success: true }
    }),
})
