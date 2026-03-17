'use client'

import {
  GitFork,
  GitMerge,
  Key,
  Layers,
  Lightbulb,
  type LucideIcon,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Trash2,
  Upload,
  UserMinus,
  UserPlus,
  Webhook,
  XCircle,
} from 'lucide-react'

const ACTION_CONFIG: Record<string, { icon: LucideIcon; label: string }> = {
  PACKAGE_CREATED: { icon: PackagePlus, label: 'Created package' },
  PACKAGE_UPDATED: { icon: Pencil, label: 'Updated package' },
  PACKAGE_DELETED: { icon: Trash2, label: 'Deleted package' },
  VERSION_PUBLISHED: { icon: Upload, label: 'Published version' },
  PACKAGE_FORKED: { icon: GitFork, label: 'Forked package' },
  API_KEY_CREATED: { icon: Key, label: 'Created API key' },
  API_KEY_REVOKED: { icon: Key, label: 'Revoked API key' },
  ORG_CREATED: { icon: Plus, label: 'Created organisation' },
  MEMBER_INVITED: { icon: UserPlus, label: 'Invited member' },
  MEMBER_REMOVED: { icon: UserMinus, label: 'Removed member' },
  COLLECTION_CREATED: { icon: Layers, label: 'Created collection' },
  IMPORT_COMPLETED: { icon: Package, label: 'Completed import' },
  WEBHOOK_REGISTERED: { icon: Webhook, label: 'Registered webhook' },
  PROPOSAL_CREATED: { icon: Lightbulb, label: 'Proposed changes' },
  PROPOSAL_MERGED: { icon: GitMerge, label: 'Merged suggestion' },
  PROPOSAL_REJECTED: { icon: XCircle, label: 'Rejected suggestion' },
  PROPOSAL_CLOSED: { icon: XCircle, label: 'Closed suggestion' },
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

type ActivityEntry = {
  id: string
  action: string
  resource: string
  resourceId: string | null
  metadata: unknown
  createdAt: Date
  user: { name: string | null; image: string | null } | null
}

type ActivityFeedProps = {
  entries: ActivityEntry[]
}

export function ActivityFeed({ entries }: ActivityFeedProps) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground text-sm">No recent activity</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {entries.map((entry) => {
        const config = ACTION_CONFIG[entry.action]
        const Icon = config?.icon ?? Package
        const label = config?.label ?? entry.action.toLowerCase().replace(/_/g, ' ')
        const metadata = entry.metadata as Record<string, unknown> | null
        const resourceName =
          (metadata?.name as string) ?? (metadata?.slug as string) ?? entry.resourceId ?? ''

        return (
          <div
            key={entry.id}
            className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
          >
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <span className="font-medium">{label}</span>
                {resourceName && <span className="text-muted-foreground"> {resourceName}</span>}
              </p>
              <p className="text-muted-foreground text-xs">
                {formatRelativeTime(new Date(entry.createdAt))}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
