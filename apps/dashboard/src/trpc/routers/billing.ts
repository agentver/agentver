import { prisma } from '@agentver/database'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { getBillingProvider } from '@/lib/billing'
import { protectedProcedure, router } from '../init'

function requireBilling() {
  const provider = getBillingProvider()
  if (!provider) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Billing is not available in this edition',
    })
  }
  return provider
}

async function assertOrgAdmin(userId: string, organisationId: string): Promise<void> {
  const membership = await prisma.organisationMember.findFirst({
    where: { userId, organisationId, role: { in: ['OWNER', 'ADMIN'] } },
    select: { id: true },
  })

  if (!membership) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You must be an organisation admin to manage billing',
    })
  }
}

export const billingRouter = router({
  plans: protectedProcedure.query(async () => {
    const provider = requireBilling()
    return provider.getPlans()
  }),

  subscription: protectedProcedure
    .input(z.object({ organisationId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOrgAdmin(ctx.user.id, input.organisationId)

      const subscription = await prisma.subscription.findUnique({
        where: { organisationId: input.organisationId },
        select: {
          id: true,
          status: true,
          stripePriceId: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          createdAt: true,
        },
      })

      return subscription
    }),

  createCheckout: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        priceId: z.string(),
        returnUrl: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const provider = requireBilling()
      await assertOrgAdmin(ctx.user.id, input.organisationId)
      return provider.createCheckoutSession(input.organisationId, input.priceId, input.returnUrl)
    }),

  createPortal: protectedProcedure
    .input(
      z.object({
        organisationId: z.string(),
        returnUrl: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const provider = requireBilling()
      await assertOrgAdmin(ctx.user.id, input.organisationId)
      return provider.createPortalSession(input.organisationId, input.returnUrl)
    }),
})
