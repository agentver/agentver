'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@agentver/ui/components/card'
import { Check, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { trpc } from '@/trpc/client'

const STATUS_LABELS: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  TRIALING: { label: 'Trialing', variant: 'secondary' },
  ACTIVE: { label: 'Active', variant: 'default' },
  PAST_DUE: { label: 'Past Due', variant: 'destructive' },
  CANCELLED: { label: 'Cancelled', variant: 'outline' },
  UNPAID: { label: 'Unpaid', variant: 'destructive' },
}

export default function BillingSettingsPage() {
  // billing router is only available in cloud edition — this page is gated behind isCloud()
  const billing = trpc.billing!
  const orgs = trpc.organisations.list.useQuery()
  const orgId = orgs.data?.[0]?.id

  const plans = billing.plans.useQuery(undefined, { enabled: !!orgId })
  const subscription = billing.subscription.useQuery(
    { organisationId: orgId! },
    { enabled: !!orgId }
  )

  const createCheckout = billing.createCheckout.useMutation({
    onSuccess: (data: { url: string }) => {
      window.location.href = data.url
    },
    onError: (error: { message: string }) => {
      toast.error(error.message)
    },
  })

  const createPortal = billing.createPortal.useMutation({
    onSuccess: (data: { url: string }) => {
      window.location.href = data.url
    },
    onError: (error: { message: string }) => {
      toast.error(error.message)
    },
  })

  if (!orgId) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const currentStatus = subscription.data?.status
  const statusInfo = currentStatus ? STATUS_LABELS[currentStatus] : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold text-xl tracking-tight">Billing</h2>
        <p className="text-muted-foreground text-sm">
          Manage your subscription and billing details.
        </p>
      </div>

      {subscription.data && statusInfo && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Current Subscription</CardTitle>
                <CardDescription>
                  {subscription.data.cancelAtPeriodEnd
                    ? 'Your subscription will end at the current billing period'
                    : 'Your subscription is managed through Stripe'}
                </CardDescription>
              </div>
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 text-sm">
                {subscription.data.currentPeriodEnd && (
                  <p className="text-muted-foreground">
                    Current period ends{' '}
                    {new Date(subscription.data.currentPeriodEnd).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  createPortal.mutate({
                    organisationId: orgId,
                    returnUrl: `${window.location.origin}/settings/billing`,
                  })
                }
                disabled={createPortal.isPending}
              >
                {createPortal.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <ExternalLink className="mr-2 size-4" />
                )}
                Manage Subscription
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {plans.data?.map((plan) => {
          const isCurrent = subscription.data?.stripePriceId === plan.id
          const isFree = plan.priceMonthly === 0

          return (
            <Card key={plan.id} className={isCurrent ? 'border-primary ring-1 ring-primary' : ''}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="pt-2">
                  <span className="font-bold text-3xl">
                    {isFree ? 'Free' : `$${plan.priceMonthly}`}
                  </span>
                  {!isFree && <span className="text-muted-foreground text-sm">/seat/month</span>}
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2">
                      <Check className="size-4 shrink-0 text-primary" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                {!isCurrent && !isFree && (
                  <Button
                    className="mt-4 w-full"
                    onClick={() =>
                      createCheckout.mutate({
                        organisationId: orgId,
                        priceId: plan.id,
                        returnUrl: `${window.location.origin}/settings/billing`,
                      })
                    }
                    disabled={createCheckout.isPending}
                  >
                    {createCheckout.isPending ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    {subscription.data ? 'Switch to ' : 'Subscribe to '}
                    {plan.name}
                  </Button>
                )}
                {isCurrent && (
                  <div className="mt-4 text-center text-muted-foreground text-sm">Current plan</div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
