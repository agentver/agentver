import { prisma } from '@agentver/database'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { protectedProcedure, publicProcedure, router } from '../init'

const MINIMUM_PUBLIC_SKILLS = 5
const MINIMUM_TOTAL_INSTALLS = 50

type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'not_requested'

export const verificationRouter = router({
  /**
   * Request verification for an organisation.
   * MVP: auto-verifies if the org meets minimum thresholds.
   */
  requestVerification: protectedProcedure
    .input(z.object({ orgSlug: z.string() }))
    .mutation(async ({ input, ctx }): Promise<{ status: VerificationStatus }> => {
      const org = await prisma.organisation.findUnique({
        where: { slug: input.orgSlug },
        include: {
          members: { where: { userId: ctx.user.id } },
        },
      })

      if (!org) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' })
      }

      if (org.members.length === 0) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You must be a member of this organisation',
        })
      }

      // Already verified
      if (org.isVerified) {
        return { status: 'verified' }
      }

      // Check auto-verification criteria
      const publicSkillCount = await prisma.package.count({
        where: { organisationId: org.id, visibility: 'PUBLIC' },
      })

      const totals = await prisma.package.aggregate({
        where: { organisationId: org.id, visibility: 'PUBLIC' },
        _sum: { installCount: true },
      })

      const totalInstalls = totals._sum.installCount ?? 0

      if (publicSkillCount >= MINIMUM_PUBLIC_SKILLS && totalInstalls >= MINIMUM_TOTAL_INSTALLS) {
        // Auto-verify: meets criteria
        await prisma.organisation.update({
          where: { id: org.id },
          data: { isVerified: true },
        })

        // Mark all public packages as verified
        await prisma.package.updateMany({
          where: { organisationId: org.id, visibility: 'PUBLIC' },
          data: { isVerified: true },
        })

        // Mark the requesting user as a verified publisher
        await prisma.user.update({
          where: { id: ctx.user.id },
          data: { isVerifiedPublisher: true },
        })

        logAudit({
          userId: ctx.user.id,
          action: 'VERIFICATION_APPROVED',
          resource: 'Organisation',
          resourceId: org.id,
          metadata: {
            orgSlug: input.orgSlug,
            publicSkillCount,
            totalInstalls,
            autoVerified: true,
          },
        })

        return { status: 'verified' }
      }

      // Does not meet criteria — record the request as pending via audit log
      logAudit({
        userId: ctx.user.id,
        action: 'VERIFICATION_REQUESTED',
        resource: 'Organisation',
        resourceId: org.id,
        metadata: {
          orgSlug: input.orgSlug,
          publicSkillCount,
          totalInstalls,
          reason: `Needs ${MINIMUM_PUBLIC_SKILLS}+ public skills and ${MINIMUM_TOTAL_INSTALLS}+ installs`,
        },
      })

      return { status: 'pending' }
    }),

  /**
   * Check verification status for an organisation.
   * Public so that anyone can see if a publisher is verified.
   */
  checkVerification: publicProcedure
    .input(z.object({ orgSlug: z.string() }))
    .query(async ({ input }): Promise<{ status: VerificationStatus; isVerified: boolean }> => {
      const org = await prisma.organisation.findUnique({
        where: { slug: input.orgSlug },
        select: { id: true, isVerified: true },
      })

      if (!org) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' })
      }

      if (org.isVerified) {
        return { status: 'verified', isVerified: true }
      }

      return { status: 'not_requested', isVerified: false }
    }),

  /**
   * Check verification status for a specific skill.
   */
  checkSkillVerification: publicProcedure
    .input(z.object({ orgSlug: z.string(), skillName: z.string() }))
    .query(
      async ({
        input,
      }): Promise<{
        isVerified: boolean
        publisherVerified: boolean
        orgSlug: string
        skillName: string
      }> => {
        const pkg = await prisma.package.findFirst({
          where: {
            name: input.skillName,
            organisation: { slug: input.orgSlug },
          },
          select: {
            isVerified: true,
            organisation: { select: { isVerified: true, slug: true } },
          },
        })

        if (!pkg) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' })
        }

        return {
          isVerified: pkg.isVerified,
          publisherVerified: pkg.organisation.isVerified,
          orgSlug: input.orgSlug,
          skillName: input.skillName,
        }
      }
    ),
})
