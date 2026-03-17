import { prisma } from '@agentver/database'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../init'

export const teamsRouter = router({
  list: protectedProcedure
    .input(z.object({ organisationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: ctx.user.id,
            organisationId: input.organisationId,
          },
        },
      })

      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' })
      }

      return prisma.team.findMany({
        where: { organisationId: input.organisationId },
        include: {
          _count: { select: { members: true, packages: true } },
        },
        orderBy: { name: 'asc' },
      })
    }),

  getBySlug: protectedProcedure
    .input(z.object({ organisationId: z.string(), slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const team = await prisma.team.findUnique({
        where: {
          organisationId_slug: {
            organisationId: input.organisationId,
            slug: input.slug,
          },
        },
        include: {
          members: {
            include: {
              user: { select: { id: true, name: true, email: true, image: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
          _count: { select: { packages: true } },
        },
      })

      if (!team) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' })
      }

      const orgMembership = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: ctx.user.id,
            organisationId: input.organisationId,
          },
        },
      })

      if (!orgMembership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organisation' })
      }

      return team
    }),

  create: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        name: z.string().min(1).max(100),
        slug: z
          .string()
          .min(2)
          .max(50)
          .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: ctx.user.id,
            organisationId: input.organisationId,
          },
        },
      })

      if (
        !membership ||
        !(['OWNER', 'ADMIN'] as const).includes(membership.role as 'OWNER' | 'ADMIN')
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only owners and admins can create teams',
        })
      }

      const existing = await prisma.team.findUnique({
        where: {
          organisationId_slug: {
            organisationId: input.organisationId,
            slug: input.slug,
          },
        },
      })

      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A team with this slug already exists' })
      }

      return prisma.team.create({
        data: {
          name: input.name,
          slug: input.slug,
          organisationId: input.organisationId,
          members: {
            create: { userId: ctx.user.id },
          },
        },
        include: {
          _count: { select: { members: true, packages: true } },
        },
      })
    }),

  addMember: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { organisationId: true },
      })

      if (!team) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' })
      }

      const callerMembership = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: ctx.user.id,
            organisationId: team.organisationId,
          },
        },
      })

      if (
        !callerMembership ||
        !(['OWNER', 'ADMIN'] as const).includes(callerMembership.role as 'OWNER' | 'ADMIN')
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only owners and admins can add team members',
        })
      }

      const targetMembership = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: input.userId,
            organisationId: team.organisationId,
          },
        },
      })

      if (!targetMembership) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'User must be a member of the organisation',
        })
      }

      return prisma.teamMember.create({
        data: {
          teamId: input.teamId,
          userId: input.userId,
        },
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      })
    }),

  removeMember: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { organisationId: true },
      })

      if (!team) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' })
      }

      const callerMembership = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: ctx.user.id,
            organisationId: team.organisationId,
          },
        },
      })

      const isAdminOrOwner =
        callerMembership &&
        (['OWNER', 'ADMIN'] as const).includes(callerMembership.role as 'OWNER' | 'ADMIN')
      const isSelf = ctx.user.id === input.userId

      if (!isAdminOrOwner && !isSelf) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only owners, admins, or the member themselves can remove team members',
        })
      }

      const teamMember = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: input.teamId,
            userId: input.userId,
          },
        },
      })

      if (!teamMember) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User is not a member of this team' })
      }

      await prisma.teamMember.delete({ where: { id: teamMember.id } })
      return { success: true }
    }),

  delete: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const team = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { organisationId: true },
      })

      if (!team) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' })
      }

      const membership = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: ctx.user.id,
            organisationId: team.organisationId,
          },
        },
      })

      if (!membership || membership.role !== 'OWNER') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only organisation owners can delete teams',
        })
      }

      await prisma.team.delete({ where: { id: input.teamId } })
      return { success: true }
    }),
})
