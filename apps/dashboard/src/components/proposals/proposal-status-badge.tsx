'use client'

import { cn } from '@agentver/ui-utils'
import { CheckCircle, Circle, CircleDot, Eye, GitMerge, XCircle } from 'lucide-react'

type ProposalStatus = 'OPEN' | 'IN_REVIEW' | 'APPROVED' | 'MERGED' | 'REJECTED' | 'CLOSED'

const STATUS_CONFIG: Record<
  ProposalStatus,
  { label: string; className: string; icon: React.ElementType }
> = {
  OPEN: {
    label: 'Open',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: Circle,
  },
  IN_REVIEW: {
    label: 'In review',
    className: 'bg-amber-100 text-amber-800 border-amber-200',
    icon: Eye,
  },
  APPROVED: {
    label: 'Approved',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    icon: CheckCircle,
  },
  MERGED: {
    label: 'Merged',
    className: 'bg-purple-100 text-purple-800 border-purple-200',
    icon: GitMerge,
  },
  REJECTED: {
    label: 'Rejected',
    className: 'bg-red-100 text-red-800 border-red-200',
    icon: XCircle,
  },
  CLOSED: {
    label: 'Closed',
    className: 'bg-gray-100 text-gray-600 border-gray-200',
    icon: CircleDot,
  },
}

type ProposalStatusBadgeProps = {
  status: ProposalStatus
  className?: string
}

export function ProposalStatusBadge({ status, className }: ProposalStatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-medium text-xs',
        config.className,
        className
      )}
    >
      <Icon className="size-3" />
      {config.label}
    </span>
  )
}

export function getProposalStatusLabel(status: ProposalStatus): string {
  switch (status) {
    case 'OPEN':
      return 'Waiting for review'
    case 'IN_REVIEW':
      return 'Changes requested'
    case 'APPROVED':
      return 'Approved — ready to merge'
    case 'MERGED':
      return 'Merged'
    case 'REJECTED':
      return 'Rejected'
    case 'CLOSED':
      return 'Closed'
  }
}

export type { ProposalStatus }
