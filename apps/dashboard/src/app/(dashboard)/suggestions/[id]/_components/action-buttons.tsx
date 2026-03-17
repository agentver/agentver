'use client'

import { Button } from '@agentver/ui/components/button'
import { GitMerge, RotateCcw, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/trpc/client'

type ActionButtonsProps = {
  proposalId: string
  status: string
  permissions: {
    isProposalAuthor: boolean
    canMerge: boolean
    canReview: boolean
  }
}

export function ActionButtons({ proposalId, status, permissions }: ActionButtonsProps) {
  const router = useRouter()
  const utils = trpc.useUtils()

  const mergeMutation = trpc.proposals.merge.useMutation({
    onSuccess: () => {
      utils.proposals.getById.invalidate({ id: proposalId })
      router.refresh()
    },
  })

  const closeMutation = trpc.proposals.close.useMutation({
    onSuccess: () => {
      utils.proposals.getById.invalidate({ id: proposalId })
      router.refresh()
    },
  })

  const reopenMutation = trpc.proposals.reopen.useMutation({
    onSuccess: () => {
      utils.proposals.getById.invalidate({ id: proposalId })
      router.refresh()
    },
  })

  const rejectMutation = trpc.proposals.reject.useMutation({
    onSuccess: () => {
      utils.proposals.getById.invalidate({ id: proposalId })
      router.refresh()
    },
  })

  const isMerged = status === 'MERGED'
  const isRejected = status === 'REJECTED'
  const isClosed = status === 'CLOSED'
  const isTerminal = isMerged || isRejected
  const canMergeNow = permissions.canMerge && (status === 'APPROVED' || status === 'OPEN')
  const canClose = permissions.isProposalAuthor && !isTerminal && !isClosed
  const canReopen = permissions.isProposalAuthor && isClosed
  const canReject = permissions.canMerge && !isTerminal && !isClosed

  if (isTerminal && !canReopen) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canMergeNow && (
        <Button
          onClick={() => mergeMutation.mutate({ id: proposalId })}
          disabled={mergeMutation.isPending}
          className="bg-purple-600 hover:bg-purple-700"
        >
          <GitMerge className="mr-1 size-4" />
          {mergeMutation.isPending ? 'Merging...' : 'Merge'}
        </Button>
      )}

      {canReject && (
        <Button
          variant="destructive"
          onClick={() => rejectMutation.mutate({ id: proposalId })}
          disabled={rejectMutation.isPending}
        >
          <XCircle className="mr-1 size-4" />
          {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
        </Button>
      )}

      {canClose && (
        <Button
          variant="outline"
          onClick={() => closeMutation.mutate({ id: proposalId })}
          disabled={closeMutation.isPending}
        >
          <XCircle className="mr-1 size-4" />
          {closeMutation.isPending ? 'Closing...' : 'Close'}
        </Button>
      )}

      {canReopen && (
        <Button
          variant="outline"
          onClick={() => reopenMutation.mutate({ id: proposalId })}
          disabled={reopenMutation.isPending}
        >
          <RotateCcw className="mr-1 size-4" />
          {reopenMutation.isPending ? 'Reopening...' : 'Reopen'}
        </Button>
      )}
    </div>
  )
}
