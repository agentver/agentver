'use client'

import { cn } from '@agentver/ui-utils'
import { Download, Star } from 'lucide-react'
import Link from 'next/link'
import { formatCount } from '@/components/install-badge'
import { VerifiedBadge } from '@/components/verified-badge'
import { AGENT_DISPLAY } from '@/lib/agent-display'
import { PACKAGE_TYPE_DISPLAY } from '@/lib/package-types'

type ExploreCardProps = {
  name: string
  orgSlug: string
  description: string | null
  type: string
  starCount: number
  installCount: number
  compatibilityAgents: string[]
  updatedAt: Date | string
  categories?: Array<{ category: { name: string; slug: string } }>
  isVerified?: boolean
}

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

export function ExploreCard({
  name,
  orgSlug,
  description,
  type,
  starCount,
  installCount,
  compatibilityAgents,
  updatedAt,
  categories,
  isVerified,
}: ExploreCardProps) {
  return (
    <Link href={`/skills/${orgSlug}/${name}`}>
      <div className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/[0.04]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1 truncate font-display font-semibold tracking-tight">
              <span className="text-muted-foreground">@{orgSlug}/</span>
              {name}
              {isVerified && <VerifiedBadge />}
            </h3>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-0.5 font-medium text-xs',
              PACKAGE_TYPE_DISPLAY[type]?.colour ?? 'bg-secondary text-secondary-foreground'
            )}
          >
            {PACKAGE_TYPE_DISPLAY[type]?.label ?? type.toLowerCase()}
          </span>
        </div>

        {description && (
          <p className="mt-2 line-clamp-2 flex-1 text-muted-foreground text-sm leading-relaxed">
            {description}
          </p>
        )}

        {compatibilityAgents.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {compatibilityAgents.slice(0, 3).map((agent) => {
              const display = AGENT_DISPLAY[agent]
              return (
                <span
                  key={agent}
                  className={cn(
                    'rounded-full px-2 py-0.5 font-medium text-xs',
                    display?.colour ??
                      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                  )}
                >
                  {display?.label ?? agent}
                </span>
              )
            })}
            {compatibilityAgents.length > 3 && (
              <span className="px-1 text-muted-foreground text-xs">
                +{compatibilityAgents.length - 3}
              </span>
            )}
          </div>
        )}

        {categories && categories.length > 0 && (
          <div className="mt-2">
            <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs">
              {categories[0]!.category.name}
            </span>
          </div>
        )}

        <div className="mt-auto pt-4">
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <span className="flex items-center gap-1">
              <Star className="size-3" /> {formatCount(starCount)}
            </span>
            <span className="flex items-center gap-1">
              <Download className="size-3" /> {formatCount(installCount)}
            </span>
            <span className="ml-auto">Updated {formatTimeAgo(new Date(updatedAt))}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}
