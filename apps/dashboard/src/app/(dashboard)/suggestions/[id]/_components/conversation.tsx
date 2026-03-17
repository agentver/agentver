'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import { Textarea } from '@agentver/ui/components/textarea'
import { cn } from '@agentver/ui-utils'
import { CheckCircle2, GitMerge, MessageSquare, ShieldAlert, XCircle } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { trpc } from '@/trpc/client'

type CommentEntry = {
  id: string
  body: string
  filePath: string | null
  lineStart: number | null
  createdAt: Date
  author: { id: string; name: string | null; image: string | null }
}

type ReviewEntry = {
  id: string
  decision: string
  body: string | null
  createdAt: Date
  reviewer: { id: string; name: string | null; image: string | null }
}

type ConversationProps = {
  proposalId: string
  comments: CommentEntry[]
  reviews: ReviewEntry[]
  status: string
  createdAt: Date
  mergedAt: Date | null
  closedAt: Date | null
  authorName: string | null
}

type TimelineEntry = {
  id: string
  type: 'comment' | 'review' | 'status'
  date: Date
  data: CommentEntry | ReviewEntry | { label: string; authorName: string | null }
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - new Date(date).getTime()
  const diffMinutes = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: diffDays > 365 ? 'numeric' : undefined,
  })
}

function getDecisionBadge(decision: string) {
  switch (decision) {
    case 'APPROVED':
      return (
        <Badge className="border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
          <CheckCircle2 className="mr-1 size-3" />
          Approved
        </Badge>
      )
    case 'CHANGES_REQUESTED':
      return (
        <Badge className="border-transparent bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
          <ShieldAlert className="mr-1 size-3" />
          Changes Requested
        </Badge>
      )
    case 'COMMENTED':
      return (
        <Badge className="border-transparent bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
          <MessageSquare className="mr-1 size-3" />
          Commented
        </Badge>
      )
    default:
      return null
  }
}

export function Conversation({
  proposalId,
  comments,
  reviews,
  status,
  createdAt,
  mergedAt,
  closedAt,
  authorName,
}: ConversationProps) {
  // Build a timeline from comments, reviews, and status changes
  const timeline: TimelineEntry[] = []

  // Opening event
  timeline.push({
    id: 'opened',
    type: 'status',
    date: new Date(createdAt),
    data: { label: 'opened this suggestion', authorName },
  })

  // General comments (no filePath = not inline)
  for (const comment of comments) {
    if (!comment.filePath) {
      timeline.push({
        id: comment.id,
        type: 'comment',
        date: new Date(comment.createdAt),
        data: comment,
      })
    }
  }

  // Reviews
  for (const review of reviews) {
    timeline.push({ id: review.id, type: 'review', date: new Date(review.createdAt), data: review })
  }

  // Status events
  if (mergedAt) {
    timeline.push({
      id: 'merged',
      type: 'status',
      date: new Date(mergedAt),
      data: { label: 'merged this suggestion', authorName: null },
    })
  }
  if (closedAt && status === 'CLOSED') {
    timeline.push({
      id: 'closed',
      type: 'status',
      date: new Date(closedAt),
      data: { label: 'closed this suggestion', authorName },
    })
  }
  if (closedAt && status === 'REJECTED') {
    timeline.push({
      id: 'rejected',
      type: 'status',
      date: new Date(closedAt),
      data: { label: 'rejected this suggestion', authorName: null },
    })
  }

  // Sort by date
  timeline.sort((a, b) => a.date.getTime() - b.date.getTime())

  return (
    <div className="space-y-4">
      {/* Timeline */}
      <div className="relative space-y-0">
        {timeline.map((entry) => (
          <div key={entry.id} className="relative pb-4 last:pb-0">
            {entry.type === 'comment' && <CommentCard comment={entry.data as CommentEntry} />}
            {entry.type === 'review' && <ReviewCard review={entry.data as ReviewEntry} />}
            {entry.type === 'status' && (
              <StatusEvent
                data={entry.data as { label: string; authorName: string | null }}
                date={entry.date}
                entryId={entry.id}
              />
            )}
          </div>
        ))}
      </div>

      {/* Add comment form */}
      <AddCommentForm proposalId={proposalId} />
    </div>
  )
}

function CommentCard({ comment }: { comment: CommentEntry }) {
  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
        {comment.author.image ? (
          <img src={comment.author.image} alt="" className="size-6 rounded-full" />
        ) : (
          <div className="flex size-6 items-center justify-center rounded-full bg-muted font-medium text-xs">
            {(comment.author.name ?? '?')[0]}
          </div>
        )}
        <span className="font-medium text-sm">{comment.author.name ?? 'Unknown'}</span>
        <span className="text-muted-foreground text-xs">
          commented {formatRelativeTime(comment.createdAt)}
        </span>
      </div>
      <div className="px-4 py-3">
        <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
      </div>
    </div>
  )
}

function ReviewCard({ review }: { review: ReviewEntry }) {
  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
        {review.reviewer.image ? (
          <img src={review.reviewer.image} alt="" className="size-6 rounded-full" />
        ) : (
          <div className="flex size-6 items-center justify-center rounded-full bg-muted font-medium text-xs">
            {(review.reviewer.name ?? '?')[0]}
          </div>
        )}
        <span className="font-medium text-sm">{review.reviewer.name ?? 'Unknown'}</span>
        <span className="text-muted-foreground text-xs">
          reviewed {formatRelativeTime(review.createdAt)}
        </span>
        {getDecisionBadge(review.decision)}
      </div>
      {review.body && (
        <div className="px-4 py-3">
          <p className="whitespace-pre-wrap text-sm">{review.body}</p>
        </div>
      )}
    </div>
  )
}

function StatusEvent({
  data,
  date,
  entryId,
}: {
  data: { label: string; authorName: string | null }
  date: Date
  entryId: string
}) {
  const iconMap: Record<string, typeof GitMerge> = {
    opened: MessageSquare,
    merged: GitMerge,
    closed: XCircle,
    rejected: XCircle,
  }
  const colourMap: Record<string, string> = {
    opened: 'text-green-600 dark:text-green-400',
    merged: 'text-purple-600 dark:text-purple-400',
    closed: 'text-gray-500',
    rejected: 'text-red-600 dark:text-red-400',
  }

  const Icon = iconMap[entryId] ?? MessageSquare
  const colour = colourMap[entryId] ?? 'text-muted-foreground'

  return (
    <div className="flex items-center gap-3 py-2 text-sm">
      <Icon className={cn('size-4', colour)} />
      <span>
        {data.authorName && <span className="font-medium">{data.authorName}</span>} {data.label}
      </span>
      <span className="text-muted-foreground text-xs">{formatRelativeTime(date)}</span>
    </div>
  )
}

function AddCommentForm({ proposalId }: { proposalId: string }) {
  const [body, setBody] = useState('')
  const utils = trpc.useUtils()

  const commentMutation = trpc.proposals.comment.useMutation({
    onSuccess: () => {
      setBody('')
      utils.proposals.getById.invalidate({ id: proposalId })
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    commentMutation.mutate({ proposalId, body: body.trim() })
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-background p-4">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment..."
        rows={3}
        className="mb-3"
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!body.trim() || commentMutation.isPending}>
          {commentMutation.isPending ? 'Submitting...' : 'Comment'}
        </Button>
      </div>
    </form>
  )
}
