'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@agentver/ui/components/avatar'
import { cn } from '@agentver/ui-utils'
import { MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { type ProposalStatus, ProposalStatusBadge } from './proposal-status-badge'

type ProposalCardProps = {
  id: string
  title: string
  status: ProposalStatus
  author: {
    name: string | null
    image: string | null
  }
  commentCount: number
  reviewCount: number
  createdAt: Date
  orgSlug: string
  packageName: string
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - new Date(date).getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function getAuthorInitials(name: string | null): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function ProposalCard({
  id,
  title,
  status,
  author,
  commentCount,
  reviewCount,
  createdAt,
  orgSlug,
  packageName,
}: ProposalCardProps) {
  return (
    <Link href={`/skills/${orgSlug}/${packageName}/proposals/${id}`}>
      <div
        className={cn(
          'flex items-start gap-4 rounded-2xl border border-border bg-card px-5 py-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/[0.04]'
        )}
      >
        <Avatar className="mt-0.5 size-8">
          {author.image && <AvatarImage src={author.image} alt={author.name ?? 'Author'} />}
          <AvatarFallback className="text-xs">{getAuthorInitials(author.name)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display font-semibold text-sm leading-snug">{title}</h3>
            <ProposalStatusBadge status={status} />
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-muted-foreground text-xs">
            <span>{author.name ?? 'Unknown'}</span>
            <span>{formatRelativeTime(createdAt)}</span>
            {commentCount > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare className="size-3" />
                {commentCount}
              </span>
            )}
            {reviewCount > 0 && (
              <span>
                {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}
