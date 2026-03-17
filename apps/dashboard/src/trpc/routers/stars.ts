import { prisma } from '@agentver/database'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { invalidateOnStarChange } from '@/lib/redis/invalidation'
import { protectedProcedure, router } from '../init'

/**
 * Check whether a user has read access to a package.
 * Public packages are readable by anyone; private/team packages require org membership.
 */
async function hasPackageAccess(packageId: string, userId: string): Promise<boolean> {
  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    select: {
      visibility: true,
      organisationId: true,
      teamId: true,
    },
  })

  if (!pkg) return false
  if (pkg.visibility === 'PUBLIC') return true

  if (pkg.visibility === 'TEAM' && pkg.teamId) {
    const teamMember = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: pkg.teamId, userId } },
    })
    if (teamMember) return true
  }

  const orgMember = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId, organisationId: pkg.organisationId } },
  })

  return !!orgMember
}

export const starsRouter = router({
  star: protectedProcedure
    .input(z.object({ packageId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const canAccess = await hasPackageAccess(input.packageId, ctx.user.id)
      if (!canAccess) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No access to this package' })
      }

      await prisma.$transaction(async (tx) => {
        await tx.star.upsert({
          where: {
            userId_packageId: {
              userId: ctx.user.id,
              packageId: input.packageId,
            },
          },
          create: {
            userId: ctx.user.id,
            packageId: input.packageId,
          },
          update: {},
        })

        await tx.package.update({
          where: { id: input.packageId },
          data: {
            starCount: {
              increment: 1,
            },
          },
        })
      })

      // Re-read the count to handle the upsert case (already starred)
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        select: { starCount: true },
      })

      const actualCount = await prisma.star.count({
        where: { packageId: input.packageId },
      })

      // Correct starCount if it drifted from the actual star records
      if (pkg && pkg.starCount !== actualCount) {
        await prisma.package.update({
          where: { id: input.packageId },
          data: { starCount: actualCount },
        })
      }

      // Invalidate caches
      const starPkgDetails = await prisma.package.findUnique({
        where: { id: input.packageId },
        select: { name: true, organisation: { select: { slug: true } } },
      })
      if (starPkgDetails) {
        invalidateOnStarChange(starPkgDetails.organisation.slug, starPkgDetails.name).catch(
          () => {}
        )
      }

      return { starred: true, count: actualCount }
    }),

  unstar: protectedProcedure
    .input(z.object({ packageId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.star.findUnique({
        where: {
          userId_packageId: {
            userId: ctx.user.id,
            packageId: input.packageId,
          },
        },
      })

      if (!existing) {
        const count = await prisma.star.count({
          where: { packageId: input.packageId },
        })
        return { starred: false, count }
      }

      await prisma.$transaction(async (tx) => {
        await tx.star.delete({
          where: {
            userId_packageId: {
              userId: ctx.user.id,
              packageId: input.packageId,
            },
          },
        })

        await tx.package.update({
          where: { id: input.packageId },
          data: {
            starCount: {
              decrement: 1,
            },
          },
        })
      })

      // Ensure starCount never goes below 0
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        select: { starCount: true },
      })

      if (pkg && pkg.starCount < 0) {
        await prisma.package.update({
          where: { id: input.packageId },
          data: { starCount: 0 },
        })
      }

      const count = await prisma.star.count({
        where: { packageId: input.packageId },
      })

      // Invalidate caches
      const unstarPkgDetails = await prisma.package.findUnique({
        where: { id: input.packageId },
        select: { name: true, organisation: { select: { slug: true } } },
      })
      if (unstarPkgDetails) {
        invalidateOnStarChange(unstarPkgDetails.organisation.slug, unstarPkgDetails.name).catch(
          () => {}
        )
      }

      return { starred: false, count }
    }),

  isStarred: protectedProcedure
    .input(z.object({ packageId: z.string() }))
    .query(async ({ input, ctx }) => {
      const star = await prisma.star.findUnique({
        where: {
          userId_packageId: {
            userId: ctx.user.id,
            packageId: input.packageId,
          },
        },
      })

      const count = await prisma.star.count({
        where: { packageId: input.packageId },
      })

      return { starred: !!star, count }
    }),

  getStarredPackages: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const stars = await prisma.star.findMany({
        where: { userId: ctx.user.id },
        skip: input.offset,
        take: input.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          package: {
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              type: true,
              starCount: true,
              installCount: true,
              tags: true,
              organisation: { select: { slug: true, name: true } },
            },
          },
        },
      })

      const total = await prisma.star.count({
        where: { userId: ctx.user.id },
      })

      return {
        packages: stars.map((s) => ({
          ...s.package,
          starredAt: s.createdAt,
        })),
        total,
      }
    }),
})
