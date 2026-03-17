'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@agentver/ui/components/card'
import {
  GitFork,
  type LucideIcon,
  Package,
  PackagePlus,
  Pencil,
  RefreshCw,
  SendHorizonal,
  Upload,
} from 'lucide-react'
import { trpc } from '@/trpc/client'

const ACTIVITY_CONFIG: Record<
  string,
  { icon: LucideIcon; format: (metadata: Record<string, unknown> | null) => string }
> = {
  PACKAGE_CREATED: {
    icon: PackagePlus,
    format: () => 'created this package',
  },
  PACKAGE_UPDATED: {
    icon: Pencil,
    format: () => 'updated this package',
  },
  VERSION_PUBLISHED: {
    icon: Upload,
    format: (meta) => {
      const version = meta?.version as string | undefined
      return version ? `published v${version}` : 'published a new version'
    },
  },
  PACKAGE_FORKED: {
    icon: GitFork,
    format: () => 'forked this package',
  },
  PACKAGE_SYNCED: {
    icon: RefreshCw,
    format: (meta) => {
      const version = meta?.newVersion as string | undefined
      return version ? `synced to v${version}` : 'synced from original'
    },
  },
  PROPOSAL_CREATED: {
    icon: SendHorizonal,
    format: (meta) => {
      const title = meta?.title as string | undefined
      return title ? `suggested changes: ${title}` : 'suggested changes'
    },
  },
  PROPOSAL_MERGED: {
    icon: Package,
    format: () => 'merged a suggestion',
  },
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)

  if (diffSeconds < 60) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffWeeks < 4) return `${diffWeeks}w ago`
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

type PackageActivityProps = {
  packageId: string
}

export function PackageActivity({ packageId }: PackageActivityProps) {
  const { data: entries, isLoading } = trpc.activity.getPackageActivity.useQuery({
    packageId,
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="size-7 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-1">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!entries || entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-center text-muted-foreground text-sm">
            No activity recorded yet.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {entries.map((entry) => {
            const config = ACTIVITY_CONFIG[entry.action]
            const Icon = config?.icon ?? Package
            const metadata = entry.metadata as Record<string, unknown> | null
            const actorName = entry.user?.name ?? 'Someone'
            const description = config
              ? config.format(metadata)
              : entry.action.toLowerCase().replace(/_/g, ' ')

            return (
              <div
                key={entry.id}
                className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
              >
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{actorName}</span>{' '}
                    <span className="text-muted-foreground">{description}</span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {formatRelativeTime(new Date(entry.createdAt))}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
