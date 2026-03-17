'use client'

import { cn } from '@agentver/ui-utils'
import { Download, Star, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { formatCount } from '@/components/install-badge'
import { AGENT_DISPLAY } from '@/lib/agent-display'
import { PACKAGE_TYPE_DISPLAY } from '@/lib/package-types'
import { trpc } from '@/trpc/client'

function formatTimeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)

  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffWeeks < 5) return `${diffWeeks}w ago`
  return `${diffMonths}mo ago`
}

export function TrendingSection() {
  const { data, isLoading } = trpc.search.trending.useQuery({ limit: 8 })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-5 text-primary" />
          <h3 className="font-display font-semibold text-lg tracking-tight">Trending Skills</h3>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-52 w-72 shrink-0 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  const packages = data ?? []
  if (packages.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="size-5 text-primary" />
        <h3 className="font-display font-semibold text-lg tracking-tight">Trending Skills</h3>
      </div>
      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
        {packages.map((pkg) => (
          <Link
            key={pkg.id}
            href={`/skills/${pkg.organisation.slug}/${pkg.name}`}
            className="group w-72 shrink-0"
          >
            <div className="rounded-2xl border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/[0.04]">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h4 className="truncate font-display font-semibold tracking-tight">{pkg.name}</h4>
                  <p className="text-muted-foreground text-xs">{pkg.organisation.slug}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-0.5 font-medium text-xs',
                    PACKAGE_TYPE_DISPLAY[pkg.type]?.colour ??
                      'bg-secondary text-secondary-foreground'
                  )}
                >
                  {PACKAGE_TYPE_DISPLAY[pkg.type]?.label ?? pkg.type.toLowerCase()}
                </span>
              </div>

              {pkg.description && (
                <p className="mt-3 line-clamp-2 text-muted-foreground text-sm leading-relaxed">
                  {pkg.description}
                </p>
              )}

              {pkg.compatibilityAgents.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {pkg.compatibilityAgents.slice(0, 3).map((agent) => {
                    const display = AGENT_DISPLAY[agent]
                    return (
                      <span
                        key={agent}
                        className={cn(
                          'rounded-full px-2 py-0.5 font-medium text-xs',
                          display?.colour ?? 'bg-gray-100 text-gray-700'
                        )}
                      >
                        {display?.label ?? agent}
                      </span>
                    )
                  })}
                  {pkg.compatibilityAgents.length > 3 && (
                    <span className="px-1 text-muted-foreground text-xs">
                      +{pkg.compatibilityAgents.length - 3}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-4 flex items-center gap-3 text-muted-foreground text-xs">
                <span className="flex items-center gap-1">
                  <Star className="size-3" /> {formatCount(pkg.starCount)}
                </span>
                <span className="flex items-center gap-1">
                  <Download className="size-3" /> {formatCount(pkg.installCount)}
                </span>
                <span className="ml-auto">Updated {formatTimeAgo(new Date(pkg.updatedAt))}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
