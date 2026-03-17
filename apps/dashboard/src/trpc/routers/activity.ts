import { prisma } from '@agentver/database'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../init'

export const activityRouter = router({
  /**
   * Fetch audit log entries for a specific package.
   * Includes direct package actions and related proposal activity.
   * Returns the last 30 entries with actor information.
   */
  getPackageActivity: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        limit: z.number().min(1).max(100).default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const pkg = await prisma.package.findUnique({
        where: { id: input.packageId },
        select: {
          id: true,
          visibility: true,
          organisation: {
            select: {
              members: { where: { userId: ctx.user.id }, select: { id: true } },
            },
          },
        },
      })

      if (!pkg) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' })
      }

      const isMember = pkg.organisation.members.length > 0
      if (pkg.visibility !== 'PUBLIC' && !isMember) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not authorised to view this package activity',
        })
      }

      // Gather proposal IDs linked to this package so we capture
      // proposal-related activity in the feed as well.
      const proposals = await prisma.changeProposal.findMany({
        where: { packageId: input.packageId },
        select: { id: true },
      })

      const proposalIds = proposals.map((p) => p.id)

      const resourceIds = [input.packageId, ...proposalIds]

      return prisma.auditLog.findMany({
        where: { resourceId: { in: resourceIds } },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        select: {
          id: true,
          action: true,
          resource: true,
          resourceId: true,
          metadata: true,
          createdAt: true,
          user: { select: { name: true, image: true } },
        },
      })
    }),
})
