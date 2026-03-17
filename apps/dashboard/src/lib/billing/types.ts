export type Plan = {
  id: string
  name: string
  description: string
  priceMonthly: number
  priceCurrency: string
  features: string[]
}

export type BillingProvider = {
  getPlans(): Promise<Plan[]>
  createCheckoutSession(
    organisationId: string,
    priceId: string,
    returnUrl: string
  ): Promise<{ url: string }>
  createPortalSession(organisationId: string, returnUrl: string): Promise<{ url: string }>
  handleWebhook(body: string, signature: string): Promise<void>
}
