'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@agentver/ui/components/avatar'
import { Button } from '@agentver/ui/components/button'
import { Textarea } from '@agentver/ui/components/textarea'
import { cn } from '@agentver/ui-utils'
import { CheckCircle, MessageSquare, Send, XCircle } from 'lucide-react'
import { useState } from 'react'

type CommentEntry = {
  id: string
  body: string
  createdAt: Date
  author: {
    id: string
    name: string | null
    image: string | null
  }
}

type ReviewEntry = {
  id: string
  decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'
  body: string | null
  createdAt: Date
  reviewer: {
    id: string
    name: string | null
    image: string | null
  }
}

type TimelineEntry = { type: 'comment'; data: CommentEntry } | { type: 'review'; data: ReviewEntry }

type CommentThreadProps = {
  comments: CommentEntry[]
  reviews: ReviewEntry[]
  onSubmitComment: (body: string) => void
  isSubmitting: boolean
  canComment: boolean
}

function getInitials(name: string | null): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
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

const REVIEW_DECISION_CONFIG: Record<
  ReviewEntry['decision'],
  { label: string; className: string; icon: React.ElementType }
> = {
  APPROVED: {
    label: 'approved this suggestion',
    className: 'border-emerald-200 bg-emerald-50',
    icon: CheckCircle,
  },
  CHANGES_REQUESTED: {
    label: 'requested changes',
    className: 'border-amber-200 bg-amber-50',
    icon: XCircle,
  },
  COMMENTED: {
    label: 'left a review comment',
    className: 'border-border bg-muted/50',
    icon: MessageSquare,
  },
}

export function CommentThread({
  comments,
  reviews,
  onSubmitComment,
  isSubmitting,
  canComment,
}: CommentThreadProps) {
  const [commentBody, setCommentBody] = useState('')

  // Merge comments and reviews into a single chronological timeline
  const timeline: TimelineEntry[] = [
    ...comments.map((c): TimelineEntry => ({ type: 'comment', data: c })),
    ...reviews.map((r): TimelineEntry => ({ type: 'review', data: r })),
  ].sort(
    (a, b) =>
      new Date(a.type === 'comment' ? a.data.createdAt : a.data.createdAt).getTime() -
      new Date(b.type === 'comment' ? b.data.createdAt : b.data.createdAt).getTime()
  )

  const handleSubmit = () => {
    const trimmed = commentBody.trim()
    if (!trimmed) return
    onSubmitComment(trimmed)
    setCommentBody('')
  }

  return (
    <div className="space-y-4">
      {timeline.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border border-dashed py-8 text-center">
          <MessageSquare className="size-5 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground text-sm">No comments yet</p>
          <p className="mt-1 text-muted-foreground text-xs">
            Start the conversation by leaving a comment below.
          </p>
        </div>
      )}

      {timeline.map((entry) => {
        if (entry.type === 'comment') {
          const comment = entry.data
          return (
            <div key={`comment-${comment.id}`} className="flex gap-3">
              <Avatar className="mt-0.5 size-7">
                {comment.author.image && (
                  <AvatarImage src={comment.author.image} alt={comment.author.name ?? ''} />
                )}
                <AvatarFallback className="text-xs">
                  {getInitials(comment.author.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <span className="font-medium text-foreground">
                      {comment.author.name ?? 'Unknown'}
                    </span>
                    <span>{formatRelativeTime(comment.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm">{comment.body}</p>
                </div>
              </div>
            </div>
          )
        }

        const review = entry.data
        const config = REVIEW_DECISION_CONFIG[review.decision]
        const Icon = config.icon

        return (
          <div key={`review-${review.id}`} className="flex gap-3">
            <Avatar className="mt-0.5 size-7">
              {review.reviewer.image && (
                <AvatarImage src={review.reviewer.image} alt={review.reviewer.name ?? ''} />
              )}
              <AvatarFallback className="text-xs">
                {getInitials(review.reviewer.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className={cn('rounded-lg border p-3', config.className)}>
                <div className="flex items-center gap-2 text-xs">
                  <Icon className="size-3.5" />
                  <span className="font-medium">{review.reviewer.name ?? 'Unknown'}</span>
                  <span className="text-muted-foreground">{config.label}</span>
                  <span className="text-muted-foreground">
                    {formatRelativeTime(review.createdAt)}
                  </span>
                </div>
                {review.body && <p className="mt-1.5 whitespace-pre-wrap text-sm">{review.body}</p>}
              </div>
            </div>
          </div>
        )
      })}

      {canComment && (
        <div className="flex gap-3 pt-2">
          <div className="mt-0.5 size-7 shrink-0" />
          <div className="flex-1 space-y-2">
            <Textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.currentTarget.value)}
              placeholder="Leave a comment..."
              rows={3}
              className="resize-none"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!commentBody.trim() || isSubmitting}
              >
                <Send className="mr-1.5 size-3.5" />
                {isSubmitting ? 'Sending...' : 'Comment'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
