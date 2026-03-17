import { setBillingProvider } from '@/lib/billing'
import { stripeBillingProvider } from './stripe-provider'

export function registerBillingProvider(): void {
  setBillingProvider(stripeBillingProvider)
}
