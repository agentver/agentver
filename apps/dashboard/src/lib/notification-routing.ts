import type { NotificationType } from '@agentver/database'
import {
  Bell,
  GitCompareArrows,
  GitFork,
  GitPullRequest,
  KeyRound,
  Layers,
  type LucideIcon,
  MessageSquare,
  Package,
  Search,
  Upload,
  UserPlus,
} from 'lucide-react'

type NotificationTypeConfig = {
  icon: LucideIcon
  label: string
}

export const NOTIFICATION_TYPE_CONFIG: Record<NotificationType, NotificationTypeConfig> = {
  PROPOSAL_OPENED: { icon: GitPullRequest, label: 'Suggestion opened' },
  PROPOSAL_APPROVED: { icon: GitPullRequest, label: 'Suggestion approved' },
  PROPOSAL_MERGED: { icon: GitPullRequest, label: 'Suggestion merged' },
  PROPOSAL_REJECTED: { icon: GitPullRequest, label: 'Suggestion rejected' },
  PROPOSAL_COMMENTED: { icon: MessageSquare, label: 'Suggestion comment' },
  REVIEW_REQUESTED: { icon: Search, label: 'Review requested' },
  PACKAGE_FORKED: { icon: GitFork, label: 'Package forked' },
  PACKAGE_UPDATED: { icon: Package, label: 'Package updated' },
  VERSION_PUBLISHED: { icon: Upload, label: 'Version published' },
  MEMBER_INVITED: { icon: UserPlus, label: 'Invitation' },
  COLLECTION_SHARED: { icon: Layers, label: 'Collection shared' },
  UPSTREAM_CHANGED: { icon: GitCompareArrows, label: 'Upstream changed' },
  SECRET_ROTATION_DUE: { icon: KeyRound, label: 'Secret rotation due' },
  SECRET_EXPIRING: { icon: KeyRound, label: 'Secret expiring' },
  BUNDLE_UPDATED: { icon: Package, label: 'Bundle updated' },
}

/**
 * Build a URL path for a notification based on its type and resource metadata.
 *
 * Returns `null` when there isn't enough info to build a link.
 */
export function getNotificationHref(
  type: NotificationType,
  resourceId: string | null,
  resourceType: string | null
): string | null {
  if (!resourceId) return null

  switch (type) {
    case 'PROPOSAL_OPENED':
    case 'PROPOSAL_APPROVED':
    case 'PROPOSAL_MERGED':
    case 'PROPOSAL_REJECTED':
    case 'PROPOSAL_COMMENTED':
    case 'REVIEW_REQUESTED':
      // resourceType should be "proposal", resourceId is the proposal id
      // We'd need org/name context — for now link to a generic proposal route
      if (resourceType === 'proposal') {
        return `/proposals/${resourceId}`
      }
      return null

    case 'PACKAGE_FORKED':
    case 'PACKAGE_UPDATED':
    case 'VERSION_PUBLISHED':
    case 'UPSTREAM_CHANGED':
      return `/skills?packageId=${resourceId}`

    case 'MEMBER_INVITED':
      return '/settings/organisation'

    case 'COLLECTION_SHARED':
      return '/collections'

    default:
      return null
  }
}

/**
 * Get a default icon for notifications when the type is unknown.
 */
export function getNotificationIcon(type: NotificationType): LucideIcon {
  return NOTIFICATION_TYPE_CONFIG[type]?.icon ?? Bell
}

/**
 * Format a relative timestamp in en-GB style.
 */
export function formatNotificationTime(date: Date): string {
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
