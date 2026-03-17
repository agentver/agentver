import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import Stripe from 'stripe'
import type { BillingProvider, Plan } from '@/lib/billing/types'

const logger = createLogger('ee:billing:stripe')

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'For individuals and open source',
    priceMonthly: 0,
    priceCurrency: 'USD',
    features: [
      'Fully open-source platform',
      'Unlimited public skills',
      'Up to 5 private skills',
      '43+ agent support',
      'Built-in security scanner',
      'Community support',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    description: 'For teams that manage and share AI skills together',
    priceMonthly: 4,
    priceCurrency: 'USD',
    features: [
      'Everything in Free',
      'Unlimited private skills',
      'Organisations & teams',
      'Role-based access',
      'Suggestions & reviews',
      'Import gateway',
      'Audit logging',
      'Email support',
    ],
  },
]

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is required for cloud billing')
  return new Stripe(key)
}

export const stripeBillingProvider: BillingProvider = {
  async getPlans() {
    return PLANS
  },

  async createCheckoutSession(organisationId, priceId, returnUrl) {
    const stripe = getStripe()
    const sub = await prisma.subscription.findUnique({
      where: { organisationId },
    })

    let customerId = sub?.stripeCustomerId
    if (!customerId) {
      const org = await prisma.organisation.findUniqueOrThrow({
        where: { id: organisationId },
      })
      const customer = await stripe.customers.create({
        name: org.name,
        metadata: { organisationId },
      })
      customerId = customer.id

      await prisma.subscription.create({
        data: {
          organisationId,
          stripeCustomerId: customerId,
        },
      })
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${returnUrl}?success=true`,
      cancel_url: `${returnUrl}?cancelled=true`,
      metadata: { organisationId },
    })

    if (!session.url) {
      throw new Error('Stripe checkout session did not return a URL')
    }

    return { url: session.url }
  },

  async createPortalSession(organisationId, returnUrl) {
    const stripe = getStripe()
    const sub = await prisma.subscription.findUnique({
      where: { organisationId },
    })

    if (!sub) {
      throw new Error('No subscription found for this organisation')
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: returnUrl,
    })

    return { url: session.url }
  },

  async handleWebhook(body, signature) {
    const stripe = getStripe()
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is required')

    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret)

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const subscriptionId = session.subscription as string
        const customerId = session.customer as string
        const organisationId = session.metadata?.organisationId
        if (!organisationId) {
          logger.warn('checkout.session.completed missing organisationId in metadata')
          break
        }

        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId)
        const firstItem = stripeSub.items.data[0]

        await prisma.subscription.upsert({
          where: { stripeCustomerId: customerId },
          create: {
            organisationId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            stripePriceId: firstItem?.price.id,
            status: 'ACTIVE',
            currentPeriodStart: firstItem ? new Date(firstItem.current_period_start * 1000) : null,
            currentPeriodEnd: firstItem ? new Date(firstItem.current_period_end * 1000) : null,
          },
          update: {
            stripeSubscriptionId: subscriptionId,
            stripePriceId: firstItem?.price.id,
            status: 'ACTIVE',
            currentPeriodStart: firstItem ? new Date(firstItem.current_period_start * 1000) : null,
            currentPeriodEnd: firstItem ? new Date(firstItem.current_period_end * 1000) : null,
          },
        })

        logger.info('Subscription activated', { organisationId, subscriptionId })
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object
        const status = mapStripeStatus(sub)
        const subItem = sub.items.data[0]

        await prisma.subscription.update({
          where: { stripeSubscriptionId: sub.id },
          data: {
            status,
            stripePriceId: subItem?.price.id,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            currentPeriodStart: subItem ? new Date(subItem.current_period_start * 1000) : null,
            currentPeriodEnd: subItem ? new Date(subItem.current_period_end * 1000) : null,
          },
        })

        logger.info('Subscription updated', { subscriptionId: sub.id, status })
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object

        await prisma.subscription.update({
          where: { stripeSubscriptionId: sub.id },
          data: { status: 'CANCELLED' },
        })

        logger.info('Subscription cancelled', { subscriptionId: sub.id })
        break
      }

      default:
        logger.debug('Unhandled Stripe event', { type: event.type })
    }
  },
}

function mapStripeStatus(sub: Stripe.Subscription): 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'UNPAID' {
  if (sub.cancel_at_period_end) return 'CANCELLED'
  switch (sub.status) {
    case 'active':
      return 'ACTIVE'
    case 'past_due':
      return 'PAST_DUE'
    default:
      return 'UNPAID'
  }
}
