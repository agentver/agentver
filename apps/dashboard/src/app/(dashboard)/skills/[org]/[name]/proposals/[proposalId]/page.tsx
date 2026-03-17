'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@agentver/ui/components/avatar'
import { Button } from '@agentver/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@agentver/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentver/ui/components/dialog'
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import { Separator } from '@agentver/ui/components/separator'
import { Textarea } from '@agentver/ui/components/textarea'
import { ArrowLeft, Edit } from 'lucide-react'
import Link from 'next/link'
import { use, useState } from 'react'
import { CommentThread } from '@/components/proposals/comment-thread'
import { DiffView } from '@/components/proposals/diff-view'
import {
  getProposalStatusLabel,
  ProposalStatusBadge,
} from '@/components/proposals/proposal-status-badge'
import { ReviewActions } from '@/components/proposals/review-actions'
import { trpc } from '@/trpc/client'

function getInitials(name: string | null): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export default function ProposalDetailPage({
  params,
}: {
  params: Promise<{ org: string; name: string; proposalId: string }>
}) {
  const { org, name, proposalId } = use(params)
  const utils = trpc.useUtils()

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editContent, setEditContent] = useState('')

  const { data: proposal, isLoading, error } = trpc.proposals.getById.useQuery({ id: proposalId })

  const commentMutation = trpc.proposals.comment.useMutation({
    onSuccess: () => {
      utils.proposals.getById.invalidate({ id: proposalId })
    },
  })

  const reviewMutation = trpc.proposals.submitReview.useMutation({
    onSuccess: () => {
      utils.proposals.getById.invalidate({ id: proposalId })
    },
  })

  const mergeMutation = trpc.proposals.merge.useMutation({
    onSuccess: () => {
      utils.proposals.getById.invalidate({ id: proposalId })
    },
  })

  const rejectMutation = trpc.proposals.reject.useMutation({
    onSuccess: () => {
      utils.proposals.getById.invalidate({ id: proposalId })
    },
  })

  const closeMutation = trpc.proposals.close.useMutation({
    onSuccess: () => {
      utils.proposals.getById.invalidate({ id: proposalId })
    },
  })

  const reopenMutation = trpc.proposals.reopen.useMutation({
    onSuccess: () => {
      utils.proposals.getById.invalidate({ id: proposalId })
    },
  })

  const updateMutation = trpc.proposals.update.useMutation({
    onSuccess: () => {
      setEditDialogOpen(false)
      utils.proposals.getById.invalidate({ id: proposalId })
    },
  })

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-48 rounded bg-muted" />
        <div className="h-10 w-96 rounded bg-muted" />
        <div className="h-64 rounded-xl bg-muted" />
        <div className="h-48 rounded-xl bg-muted" />
      </div>
    )
  }

  if (error || !proposal) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        {error?.message ?? 'Proposal not found'}
      </div>
    )
  }

  const proposalContent = proposal.content as { body?: string } | null
  const proposedBody = proposalContent?.body ?? ''
  const currentContent = proposal.package.readme ?? ''

  const handleOpenEdit = () => {
    setEditTitle(proposal.title)
    setEditDescription(proposal.description ?? '')
    setEditContent(proposedBody)
    setEditDialogOpen(true)
  }

  const handleSaveEdit = () => {
    updateMutation.mutate({
      id: proposalId,
      title: editTitle.trim(),
      description: editDescription.trim() || undefined,
      content: editContent.trim(),
    })
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/skills/${org}/${name}/proposals`}
        className="inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All suggestions
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h2 className="font-display font-semibold text-2xl">{proposal.title}</h2>
            <ProposalStatusBadge status={proposal.status} />
          </div>
          <p className="text-muted-foreground text-sm">{getProposalStatusLabel(proposal.status)}</p>
        </div>
        {proposal.permissions.isProposalAuthor &&
          (proposal.status === 'OPEN' || proposal.status === 'IN_REVIEW') && (
            <Button variant="outline" size="sm" onClick={handleOpenEdit}>
              <Edit className="mr-1.5 size-3.5" />
              Edit
            </Button>
          )}
      </div>

      {/* Author info */}
      <div className="flex items-center gap-3">
        <Avatar className="size-8">
          {proposal.author.image && (
            <AvatarImage src={proposal.author.image} alt={proposal.author.name ?? ''} />
          )}
          <AvatarFallback className="text-xs">{getInitials(proposal.author.name)}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-medium text-sm">{proposal.author.name ?? 'Unknown'}</p>
          <p className="text-muted-foreground text-xs">
            Suggested on{' '}
            {new Date(proposal.createdAt).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            {proposal.baseVersion && ` \u00B7 Based on v${proposal.baseVersion}`}
          </p>
        </div>
      </div>

      {/* Description */}
      {proposal.description && (
        <Card>
          <CardContent className="pt-5">
            <p className="whitespace-pre-wrap text-sm">{proposal.description}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Diff view */}
          <Card>
            <CardHeader>
              <CardTitle>Proposed Changes</CardTitle>
            </CardHeader>
            <CardContent>
              <DiffView original={currentContent} proposed={proposedBody} />
            </CardContent>
          </Card>

          {/* Comment thread */}
          <Card>
            <CardHeader>
              <CardTitle>Discussion</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentThread
                comments={proposal.comments}
                reviews={proposal.reviews}
                onSubmitComment={(body) => {
                  commentMutation.mutate({ proposalId, body })
                }}
                isSubmitting={commentMutation.isPending}
                canComment={true}
              />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <ReviewActions
            status={proposal.status}
            permissions={proposal.permissions}
            onSubmitReview={(decision, body) => {
              reviewMutation.mutate({ proposalId, decision, body })
            }}
            onMerge={(version, changelog) => {
              mergeMutation.mutate({ id: proposalId, version, changelog })
            }}
            onReject={() => {
              rejectMutation.mutate({ id: proposalId })
            }}
            onClose={() => {
              closeMutation.mutate({ id: proposalId })
            }}
            onReopen={() => {
              reopenMutation.mutate({ id: proposalId })
            }}
            isReviewPending={reviewMutation.isPending}
            isMergePending={mergeMutation.isPending}
            isRejectPending={rejectMutation.isPending}
            isClosePending={closeMutation.isPending}
            isReopenPending={reopenMutation.isPending}
          />

          {/* Package info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Package</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Link
                href={`/skills/${org}/${name}`}
                className="font-medium text-foreground hover:underline"
              >
                {org}/{name}
              </Link>
              <Separator />
              <div className="space-y-1.5 text-muted-foreground text-xs">
                <p>Reviews: {proposal.reviews.length}</p>
                <p>Comments: {proposal.comments.length}</p>
                {proposal.mergedAt && (
                  <p>
                    Merged on{' '}
                    {new Date(proposal.mergedAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                )}
                {proposal.closedAt && !proposal.mergedAt && (
                  <p>
                    Closed on{' '}
                    {new Date(proposal.closedAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Suggestion</DialogTitle>
            <DialogDescription>
              Update the title, description, or proposed content.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.currentTarget.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.currentTarget.value)}
                rows={3}
                className="resize-none"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-content">Proposed Content</Label>
              <Textarea
                id="edit-content"
                value={editContent}
                onChange={(e) => setEditContent(e.currentTarget.value)}
                rows={12}
                className="resize-none font-mono text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={!editTitle.trim() || !editContent.trim() || updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
