import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { getBillingProvider } from '@/lib/billing'

const logger = createLogger('webhook:stripe')

export async function POST(request: Request): Promise<NextResponse> {
  const provider = getBillingProvider()
  if (!provider) {
    return NextResponse.json({ error: 'Billing is not available in this edition' }, { status: 404 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  try {
    const body = await request.text()
    await provider.handleWebhook(body, signature)
    return NextResponse.json({ received: true })
  } catch (error) {
    logger.error('Stripe webhook processing failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 400 })
  }
}
