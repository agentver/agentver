'use client'

import { cn } from '@agentver/ui-utils'
import { Building2, CreditCard, Key, Plug, Shield, User, Users, Webhook } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { FadeIn } from '@/components/fade-in'
import { OrgSwitcher } from '@/components/settings/org-switcher'

const isCloudEdition = process.env.NEXT_PUBLIC_AGENTVER_CLOUD === 'true'

type NavItem = {
  href: string
  label: string
  icon: typeof User
}

type NavSection = {
  label: string
  items: NavItem[]
}

const settingsSections: NavSection[] = [
  {
    label: 'Account',
    items: [{ href: '/settings/profile', label: 'Profile', icon: User }],
  },
  {
    label: 'Organisation',
    items: [
      { href: '/settings/organisation', label: 'Organisation', icon: Building2 },
      { href: '/settings/teams', label: 'Teams', icon: Users },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { href: '/settings/connections', label: 'Connections', icon: Plug },
      { href: '/settings/api-keys', label: 'API Keys', icon: Key },
      { href: '/settings/webhooks', label: 'Webhooks', icon: Webhook },
    ],
  },
  {
    label: 'Security',
    items: [{ href: '/settings/vault', label: 'Vault', icon: Shield }],
  },
  ...(isCloudEdition
    ? [
        {
          label: 'Billing',
          items: [{ href: '/settings/billing', label: 'Billing', icon: CreditCard }],
        },
      ]
    : []),
]

const allNavItems = settingsSections.flatMap((section) => section.items)

function SettingsLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const preserveOrg = (href: string) => {
    const org = searchParams.get('org')
    return org ? `${href}?org=${org}` : href
  }

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-description">Manage your account, organisation, and integrations.</p>
      </div>

      <div className="flex gap-8">
        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="pb-4">
            <OrgSwitcher />
          </div>
          <nav>
            {settingsSections.map((section, sectionIndex) => (
              <div key={section.label} className={cn(sectionIndex > 0 && 'mt-4')}>
                <p className="mb-2 px-3 font-medium text-muted-foreground/60 text-xs uppercase tracking-wider">
                  {section.label}
                </p>
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      href={preserveOrg(item.href)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150',
                        pathname.startsWith(item.href)
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      )}
                    >
                      <item.icon className="size-[18px]" />
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Mobile tabs */}
        <div
          className="mb-6 w-full overflow-x-auto md:hidden"
          style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
        >
          <nav className="flex gap-1 border-border border-b pb-2">
            {allNavItems.map((item) => (
              <Link
                key={item.href}
                href={preserveOrg(item.href)}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                  pathname.startsWith(item.href)
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                style={{ scrollSnapAlign: 'start' }}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Content */}
        <FadeIn className="min-w-0 flex-1">{children}</FadeIn>
      </div>
    </div>
  )
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <SettingsLayoutInner>{children}</SettingsLayoutInner>
    </Suspense>
  )
}
