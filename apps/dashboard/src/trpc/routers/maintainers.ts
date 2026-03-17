import { prisma } from '@agentver/database'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { protectedProcedure, router } from '../init'

/**
 * Verify the caller is an admin or owner of the package's organisation.
 * Returns the organisation ID on success.
 */
async function requireOrgAdminForPackage(packageId: string, userId: string): Promise<string> {
  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    select: { organisationId: true },
  })

  if (!pkg) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
  }

  const membership = await prisma.organisationMember.findUnique({
    where: {
      userId_organisationId: {
        userId,
        organisationId: pkg.organisationId,
      },
    },
    select: { role: true },
  })

  if (!membership || (membership.role !== 'ADMIN' && membership.role !== 'OWNER')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only organisation admins or owners can manage maintainers',
    })
  }

  return pkg.organisationId
}

export const maintainersRouter = router({
  list: protectedProcedure
    .input(z.object({ packageId: z.string() }))
    .query(async ({ input, ctx }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        select: {
          organisationId: true,
          visibility: true,
          teamId: true,
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      // Check access: public packages allow anyone to see maintainers,
      // private/team packages require org membership
      if (pkg.visibility !== 'PUBLIC') {
        const orgMember = await prisma.organisationMember.findUnique({
          where: {
            userId_organisationId: {
              userId: ctx.user.id,
              organisationId: pkg.organisationId,
            },
          },
        })

        if (!orgMember) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this package' })
        }
      }

      const maintainers = await prisma.skillMaintainer.findMany({
        where: { packageId: input.packageId },
        orderBy: { createdAt: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          team: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      })

      return { maintainers }
    }),

  addUser: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        userId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await requireOrgAdminForPackage(input.packageId, ctx.user.id)

      // Verify the target user exists
      const targetUser = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, name: true },
      })

      if (!targetUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })
      }

      // Check if already a maintainer
      const existing = await prisma.skillMaintainer.findFirst({
        where: {
          packageId: input.packageId,
          userId: input.userId,
        },
      })

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'User is already a maintainer of this package',
        })
      }

      const maintainer = await prisma.skillMaintainer.create({
        data: {
          packageId: input.packageId,
          userId: input.userId,
        },
        include: {
          user: {
            select: { id: true, name: true, email: true, image: true },
          },
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_UPDATED',
        resource: 'SkillMaintainer',
        resourceId: maintainer.id,
        metadata: {
          packageId: input.packageId,
          addedUserId: input.userId,
          action: 'maintainer_added',
        },
      })

      return maintainer
    }),

  addTeam: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        teamId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await requireOrgAdminForPackage(input.packageId, ctx.user.id)

      // Verify the target team exists
      const targetTeam = await prisma.team.findUnique({
        where: { id: input.teamId },
        select: { id: true, name: true },
      })

      if (!targetTeam) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' })
      }

      // Check if already a maintainer
      const existing = await prisma.skillMaintainer.findFirst({
        where: {
          packageId: input.packageId,
          teamId: input.teamId,
        },
      })

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Team is already a maintainer of this package',
        })
      }

      const maintainer = await prisma.skillMaintainer.create({
        data: {
          packageId: input.packageId,
          teamId: input.teamId,
        },
        include: {
          team: {
            select: { id: true, name: true, slug: true },
          },
        },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_UPDATED',
        resource: 'SkillMaintainer',
        resourceId: maintainer.id,
        metadata: {
          packageId: input.packageId,
          addedTeamId: input.teamId,
          action: 'maintainer_team_added',
        },
      })

      return maintainer
    }),

  remove: protectedProcedure
    .input(z.object({ maintainerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const maintainer = await prisma.skillMaintainer.findUnique({
        where: { id: input.maintainerId },
        select: { id: true, packageId: true, userId: true, teamId: true },
      })

      if (!maintainer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Maintainer not found' })
      }

      await requireOrgAdminForPackage(maintainer.packageId, ctx.user.id)

      await prisma.skillMaintainer.delete({
        where: { id: input.maintainerId },
      })

      logAudit({
        userId: ctx.user.id,
        action: 'PACKAGE_UPDATED',
        resource: 'SkillMaintainer',
        resourceId: input.maintainerId,
        metadata: {
          packageId: maintainer.packageId,
          removedUserId: maintainer.userId,
          removedTeamId: maintainer.teamId,
          action: 'maintainer_removed',
        },
      })

      return { removed: true }
    }),
})
