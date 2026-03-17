'use client'

import { Button } from '@agentver/ui/components/button'
import { Textarea } from '@agentver/ui/components/textarea'
import { cn } from '@agentver/ui-utils'
import { ChevronDown, ChevronRight, MessageSquare, Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { trpc } from '@/trpc/client'

type DiffLineType = 'add' | 'delete' | 'context'

type DiffLine = {
  type: DiffLineType
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

type DiffHunk = {
  header: string
  lines: DiffLine[]
}

type DiffFile = {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

type InlineComment = {
  id: string
  filePath: string | null
  lineStart: number | null
  lineEnd: number | null
  side: string | null
  body: string
  resolved: boolean
  parentId: string | null
  createdAt: Date
  author: { id: string; name: string | null; image: string | null }
  replies?: InlineComment[]
}

type DiffViewerProps = {
  files: DiffFile[]
  proposalId: string
  comments: InlineComment[]
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

function getStatusLabel(status: DiffFile['status']): string {
  switch (status) {
    case 'added':
      return 'Added'
    case 'modified':
      return 'Modified'
    case 'deleted':
      return 'Deleted'
    case 'renamed':
      return 'Renamed'
  }
}

function getStatusColour(status: DiffFile['status']): string {
  switch (status) {
    case 'added':
      return 'text-green-700 dark:text-green-400'
    case 'modified':
      return 'text-yellow-700 dark:text-yellow-400'
    case 'deleted':
      return 'text-red-700 dark:text-red-400'
    case 'renamed':
      return 'text-blue-700 dark:text-blue-400'
  }
}

export function DiffViewer({ files, proposalId, comments }: DiffViewerProps) {
  if (files.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <p className="font-medium">No file changes</p>
        <p className="mt-1 text-sm">The diff data is not yet available for this suggestion.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* File summary */}
      <div className="rounded-lg border bg-muted/30 p-3">
        <p className="font-medium text-sm">
          {files.length} file{files.length !== 1 ? 's' : ''} changed
        </p>
        <div className="mt-1 flex gap-4 text-sm">
          <span className="text-green-700 dark:text-green-400">
            +{files.reduce((sum, f) => sum + f.additions, 0)}
          </span>
          <span className="text-red-700 dark:text-red-400">
            -{files.reduce((sum, f) => sum + f.deletions, 0)}
          </span>
        </div>
      </div>

      {files.map((file) => {
        const fileComments = comments.filter((c) => c.filePath === file.path && !c.parentId)
        return (
          <DiffFileBlock
            key={file.path}
            file={file}
            proposalId={proposalId}
            comments={fileComments}
          />
        )
      })}
    </div>
  )
}

function DiffFileBlock({
  file,
  proposalId,
  comments,
}: {
  file: DiffFile
  proposalId: string
  comments: InlineComment[]
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="overflow-hidden rounded-lg border">
      {/* File header */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 bg-muted/50 px-4 py-2 text-left hover:bg-muted/70"
      >
        {collapsed ? (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{file.path}</span>
        <span className={cn('font-medium text-xs', getStatusColour(file.status))}>
          {getStatusLabel(file.status)}
        </span>
        <span className="text-green-700 text-xs dark:text-green-400">+{file.additions}</span>
        <span className="text-red-700 text-xs dark:text-red-400">-{file.deletions}</span>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-sm">
            <tbody>
              {file.hunks.map((hunk, hunkIndex) => (
                <HunkBlock
                  key={hunkIndex}
                  hunk={hunk}
                  filePath={file.path}
                  proposalId={proposalId}
                  comments={comments}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function HunkBlock({
  hunk,
  filePath,
  proposalId,
  comments,
}: {
  hunk: DiffHunk
  filePath: string
  proposalId: string
  comments: InlineComment[]
}) {
  return (
    <>
      {/* Hunk header */}
      <tr>
        <td
          colSpan={4}
          className="bg-blue-50 px-4 py-1 text-blue-800 text-xs dark:bg-blue-950/30 dark:text-blue-300"
        >
          {hunk.header}
        </td>
      </tr>

      {hunk.lines.map((line, lineIndex) => (
        <DiffLineRow
          key={lineIndex}
          line={line}
          filePath={filePath}
          proposalId={proposalId}
          comments={comments}
        />
      ))}
    </>
  )
}

function DiffLineRow({
  line,
  filePath,
  proposalId,
  comments,
}: {
  line: DiffLine
  filePath: string
  proposalId: string
  comments: InlineComment[]
}) {
  const [showCommentForm, setShowCommentForm] = useState(false)
  const [hovering, setHovering] = useState(false)

  const lineNumber = line.newLineNumber ?? line.oldLineNumber
  const lineComments = comments.filter((c) => c.lineStart === lineNumber && c.filePath === filePath)

  const bgClass =
    line.type === 'add'
      ? 'bg-green-50 dark:bg-green-950/20'
      : line.type === 'delete'
        ? 'bg-red-50 dark:bg-red-950/20'
        : ''

  const textClass =
    line.type === 'add'
      ? 'text-green-900 dark:text-green-200'
      : line.type === 'delete'
        ? 'text-red-900 dark:text-red-200'
        : 'text-foreground'

  const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '

  return (
    <>
      <tr
        className={cn('group', bgClass)}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {/* Old line number */}
        <td className="w-12 select-none border-r px-2 py-0 text-right text-muted-foreground text-xs">
          {line.oldLineNumber ?? ''}
        </td>
        {/* New line number */}
        <td className="w-12 select-none border-r px-2 py-0 text-right text-muted-foreground text-xs">
          {line.newLineNumber ?? ''}
        </td>
        {/* Comment button cell */}
        <td className="w-8 px-0 py-0 text-center">
          {hovering && lineNumber != null && (
            <button
              type="button"
              onClick={() => setShowCommentForm(true)}
              className="inline-flex size-5 items-center justify-center rounded bg-blue-600 text-white hover:bg-blue-700"
              title="Add comment"
            >
              <Plus className="size-3" />
            </button>
          )}
        </td>
        {/* Content */}
        <td className={cn('whitespace-pre px-2 py-0', textClass)}>
          <span className="select-none">{prefix}</span>
          {line.content}
        </td>
      </tr>

      {/* Inline comments */}
      {lineComments.length > 0 && (
        <tr>
          <td colSpan={4} className="border-y bg-muted/20 p-0">
            <div className="space-y-2 px-4 py-3">
              {lineComments.map((comment) => (
                <InlineCommentThread key={comment.id} comment={comment} proposalId={proposalId} />
              ))}
            </div>
          </td>
        </tr>
      )}

      {/* Comment form */}
      {showCommentForm && lineNumber != null && (
        <tr>
          <td colSpan={4} className="border-y bg-muted/20 p-0">
            <InlineCommentForm
              proposalId={proposalId}
              filePath={filePath}
              lineNumber={lineNumber}
              onClose={() => setShowCommentForm(false)}
            />
          </td>
        </tr>
      )}
    </>
  )
}

function InlineCommentThread({
  comment,
  proposalId,
}: {
  comment: InlineComment
  proposalId: string
}) {
  const [showReplyForm, setShowReplyForm] = useState(false)
  const utils = trpc.useUtils()

  const resolveMutation = trpc.proposals.resolveComment.useMutation({
    onSuccess: () => {
      utils.proposals.getById.invalidate({ id: proposalId })
    },
  })

  return (
    <div className="rounded-lg border bg-background">
      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {comment.author.image ? (
              <img src={comment.author.image} alt="" className="size-5 rounded-full" />
            ) : (
              <div className="flex size-5 items-center justify-center rounded-full bg-muted font-medium text-xs">
                {(comment.author.name ?? '?')[0]}
              </div>
            )}
            <span className="font-medium text-sm">{comment.author.name ?? 'Unknown'}</span>
            <span className="text-muted-foreground text-xs">
              {formatRelativeTime(comment.createdAt)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {!comment.resolved && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => resolveMutation.mutate({ commentId: comment.id })}
                disabled={resolveMutation.isPending}
              >
                Resolve
              </Button>
            )}
            {comment.resolved && (
              <span className="text-green-600 text-xs dark:text-green-400">Resolved</span>
            )}
          </div>
        </div>
        <p className="mt-1 text-sm">{comment.body}</p>
      </div>

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="border-t px-3 py-2">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="ml-4 border-muted border-l-2 py-1 pl-3">
              <div className="flex items-center gap-2">
                {reply.author.image ? (
                  <img src={reply.author.image} alt="" className="size-4 rounded-full" />
                ) : (
                  <div className="flex size-4 items-center justify-center rounded-full bg-muted text-xs">
                    {(reply.author.name ?? '?')[0]}
                  </div>
                )}
                <span className="font-medium text-xs">{reply.author.name ?? 'Unknown'}</span>
                <span className="text-muted-foreground text-xs">
                  {formatRelativeTime(reply.createdAt)}
                </span>
              </div>
              <p className="mt-0.5 text-sm">{reply.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reply form toggle */}
      <div className="border-t px-3 py-1.5">
        {showReplyForm ? (
          <InlineReplyForm
            proposalId={proposalId}
            parentId={comment.id}
            filePath={comment.filePath}
            lineNumber={comment.lineStart}
            onClose={() => setShowReplyForm(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowReplyForm(true)}
            className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
          >
            <MessageSquare className="size-3" />
            Reply
          </button>
        )}
      </div>
    </div>
  )
}

function InlineCommentForm({
  proposalId,
  filePath,
  lineNumber,
  onClose,
}: {
  proposalId: string
  filePath: string
  lineNumber: number
  onClose: () => void
}) {
  const [body, setBody] = useState('')
  const utils = trpc.useUtils()

  const commentMutation = trpc.proposals.inlineComment.useMutation({
    onSuccess: () => {
      setBody('')
      onClose()
      utils.proposals.getById.invalidate({ id: proposalId })
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    commentMutation.mutate({
      proposalId,
      body: body.trim(),
      filePath,
      lineStart: lineNumber,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 px-4 py-3">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment on this line..."
        rows={2}
        className="text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!body.trim() || commentMutation.isPending}>
          {commentMutation.isPending ? 'Submitting...' : 'Comment'}
        </Button>
      </div>
    </form>
  )
}

function InlineReplyForm({
  proposalId,
  parentId,
  filePath,
  lineNumber,
  onClose,
}: {
  proposalId: string
  parentId: string
  filePath: string | null
  lineNumber: number | null
  onClose: () => void
}) {
  const [body, setBody] = useState('')
  const utils = trpc.useUtils()

  const commentMutation = trpc.proposals.inlineComment.useMutation({
    onSuccess: () => {
      setBody('')
      onClose()
      utils.proposals.getById.invalidate({ id: proposalId })
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    commentMutation.mutate({
      proposalId,
      body: body.trim(),
      filePath: filePath ?? undefined,
      lineStart: lineNumber ?? undefined,
      parentId,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a reply..."
        rows={2}
        className="text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!body.trim() || commentMutation.isPending}>
          {commentMutation.isPending ? 'Submitting...' : 'Reply'}
        </Button>
      </div>
    </form>
  )
}
