'use client'

import { cn } from '@agentver/ui-utils'
import { ChevronRight, Home } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SEGMENT_LABELS: Record<string, string> = {
  explore: 'Explore',
  skills: 'Packages',
  new: 'New',
  collections: 'Collections',
  sources: 'Sources',
  analytics: 'Analytics',
  settings: 'Settings',
  profile: 'Profile',
  organisation: 'Organisation',
  teams: 'Teams',
  'api-keys': 'API Keys',
  admin: 'Admin',
  billing: 'Billing',
  members: 'Members',
  import: 'Import',
  mcp: 'MCP Servers',
}

type Breadcrumb = {
  label: string
  href: string
}

function buildBreadcrumbs(pathname: string): Breadcrumb[] {
  if (pathname === '/') return []

  const segments = pathname.split('/').filter(Boolean)
  const breadcrumbs: Breadcrumb[] = []

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as string
    const href = `/${segments.slice(0, i + 1).join('/')}`

    // If the parent segment is "skills" and this looks like an org slug (starts with @
    // or follows the pattern), treat it as a scoped name
    const parentSegment = i > 0 ? segments[i - 1] : undefined

    if (parentSegment === 'skills' && i === 1) {
      // This is the org segment (e.g., @myorg)
      breadcrumbs.push({
        label: segment.startsWith('@') ? segment : `@${segment}`,
        href,
      })
    } else if (parentSegment && segments[i - 2] === 'skills' && i === 2) {
      // This is the package name segment after the org
      breadcrumbs.push({ label: segment, href })
    } else {
      breadcrumbs.push({
        label: SEGMENT_LABELS[segment] ?? segment.replace(/-/g, ' '),
        href,
      })
    }
  }

  return breadcrumbs
}

export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname()
  const breadcrumbs = buildBreadcrumbs(pathname)

  if (breadcrumbs.length === 0) return null

  return (
    <nav aria-label="Breadcrumbs" className={cn('flex items-center gap-1.5 text-sm', className)}>
      {/* Home link — always visible */}
      <Link
        href="/"
        className="text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Dashboard"
      >
        <Home className="size-3.5" />
      </Link>

      {breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1
        const isHiddenOnMobile = breadcrumbs.length > 2 && index < breadcrumbs.length - 2

        return (
          <span
            key={crumb.href}
            className={cn('flex items-center gap-1.5', isHiddenOnMobile && 'hidden sm:flex')}
          >
            <ChevronRight className="size-3 text-muted-foreground/50" />
            {isLast ? (
              <span className="font-medium text-foreground">{crumb.label}</span>
            ) : (
              <Link
                href={crumb.href}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        )
      })}

      {/* Collapsed indicator on mobile when items are hidden */}
      {breadcrumbs.length > 2 && (
        <span className="flex items-center gap-1.5 sm:hidden" aria-hidden="true">
          <ChevronRight className="size-3 text-muted-foreground/50" />
          <span className="text-muted-foreground">&hellip;</span>
        </span>
      )}
    </nav>
  )
}
