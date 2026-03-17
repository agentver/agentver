import { isCommunity } from '@agentver/shared'
import type { BillingProvider } from './types'

export type { BillingProvider, Plan } from './types'

let provider: BillingProvider | null = null

export function setBillingProvider(p: BillingProvider): void {
  provider = p
}

export function getBillingProvider(): BillingProvider | null {
  if (isCommunity()) return null
  return provider
}
