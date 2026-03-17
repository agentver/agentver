'use client'

import { Button } from '@agentver/ui/components/button'
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
import { Textarea } from '@agentver/ui/components/textarea'
import { CheckCircle, GitMerge, MessageSquare, RotateCcw, X, XCircle } from 'lucide-react'
import { useState } from 'react'
import type { ProposalStatus } from './proposal-status-badge'

type ReviewActionsProps = {
  status: ProposalStatus
  permissions: {
    isProposalAuthor: boolean
    canMerge: boolean
    canReview: boolean
  }
  onSubmitReview: (decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED', body?: string) => void
  onMerge: (version?: string, changelog?: string) => void
  onReject: () => void
  onClose: () => void
  onReopen: () => void
  isReviewPending: boolean
  isMergePending: boolean
  isRejectPending: boolean
  isClosePending: boolean
  isReopenPending: boolean
}

export function ReviewActions({
  status,
  permissions,
  onSubmitReview,
  onMerge,
  onReject,
  onClose,
  onReopen,
  isReviewPending,
  isMergePending,
  isRejectPending,
  isClosePending,
  isReopenPending,
}: ReviewActionsProps) {
  const [reviewBody, setReviewBody] = useState('')
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [mergeVersion, setMergeVersion] = useState('')
  const [mergeChangelog, setMergeChangelog] = useState('')

  const isTerminal = status === 'MERGED' || status === 'REJECTED'
  const isClosed = status === 'CLOSED'
  const canMergeNow = permissions.canMerge && (status === 'APPROVED' || status === 'OPEN')

  const handleMergeConfirm = () => {
    onMerge(mergeVersion || undefined, mergeChangelog || undefined)
    setMergeDialogOpen(false)
    setMergeVersion('')
    setMergeChangelog('')
  }

  if (isTerminal) {
    return null
  }

  return (
    <>
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h3 className="font-display font-semibold text-sm">Actions</h3>

        {/* Review actions — available to org members who are not the author */}
        {permissions.canReview && !isClosed && (
          <div className="space-y-2">
            <Textarea
              value={reviewBody}
              onChange={(e) => setReviewBody(e.currentTarget.value)}
              placeholder="Leave review feedback (optional)..."
              rows={2}
              className="resize-none text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                onClick={() => {
                  onSubmitReview('APPROVED', reviewBody || undefined)
                  setReviewBody('')
                }}
                disabled={isReviewPending}
              >
                <CheckCircle className="mr-1.5 size-3.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                onClick={() => {
                  onSubmitReview('CHANGES_REQUESTED', reviewBody || undefined)
                  setReviewBody('')
                }}
                disabled={isReviewPending}
              >
                <XCircle className="mr-1.5 size-3.5" />
                Request Changes
              </Button>
              {reviewBody.trim() && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onSubmitReview('COMMENTED', reviewBody)
                    setReviewBody('')
                  }}
                  disabled={isReviewPending}
                >
                  <MessageSquare className="mr-1.5 size-3.5" />
                  Comment Only
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Merge + Reject — for package owners/admins */}
        {permissions.canMerge && !isClosed && (
          <div className="flex flex-wrap gap-2 border-border border-t pt-3">
            <Button
              size="sm"
              className="bg-purple-600 text-white hover:bg-purple-700"
              onClick={() => setMergeDialogOpen(true)}
              disabled={!canMergeNow || isMergePending}
            >
              <GitMerge className="mr-1.5 size-3.5" />
              {isMergePending ? 'Merging...' : 'Merge'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
              onClick={onReject}
              disabled={isRejectPending}
            >
              <X className="mr-1.5 size-3.5" />
              {isRejectPending ? 'Rejecting...' : 'Reject'}
            </Button>
          </div>
        )}

        {/* Close / Reopen — for proposal author */}
        {permissions.isProposalAuthor && (
          <div className="border-border border-t pt-3">
            {isClosed ? (
              <Button size="sm" variant="outline" onClick={onReopen} disabled={isReopenPending}>
                <RotateCcw className="mr-1.5 size-3.5" />
                {isReopenPending ? 'Reopening...' : 'Reopen'}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="text-muted-foreground"
                onClick={onClose}
                disabled={isClosePending}
              >
                <X className="mr-1.5 size-3.5" />
                {isClosePending ? 'Closing...' : 'Close Suggestion'}
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Suggestion</DialogTitle>
            <DialogDescription>
              This will apply the proposed changes to the package. Optionally publish a new version.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="merge-version">Version (optional)</Label>
              <Input
                id="merge-version"
                value={mergeVersion}
                onChange={(e) => setMergeVersion(e.currentTarget.value)}
                placeholder="e.g. 1.1.0"
              />
              <p className="text-muted-foreground text-xs">
                Leave blank to merge without publishing a version.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="merge-changelog">Changelog (optional)</Label>
              <Textarea
                id="merge-changelog"
                value={mergeChangelog}
                onChange={(e) => setMergeChangelog(e.currentTarget.value)}
                placeholder="Describe what this change introduces..."
                rows={3}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-purple-600 text-white hover:bg-purple-700"
              onClick={handleMergeConfirm}
              disabled={isMergePending}
            >
              <GitMerge className="mr-1.5 size-3.5" />
              {isMergePending ? 'Merging...' : 'Confirm Merge'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
