export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startRetryScheduler } = await import('@/lib/webhooks/service')
    const stopRetryScheduler = startRetryScheduler()
    process.on('SIGTERM', stopRetryScheduler)
    process.on('SIGINT', stopRetryScheduler)

    if (process.env.AGENTVER_CLOUD === 'true') {
      const { registerBillingProvider } = await import('@/lib/billing/register')
      registerBillingProvider()
    }
  }
}
