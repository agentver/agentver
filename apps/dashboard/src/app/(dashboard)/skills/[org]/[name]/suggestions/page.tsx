'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Card, CardContent } from '@agentver/ui/components/card'
import { cn } from '@agentver/ui-utils'
import { MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { use, useState } from 'react'
import { trpc } from '@/trpc/client'
import { SkillHeader } from '../_components/skill-header'
import { SkillPageSkeleton } from '../_components/skill-page-skeleton'
import { SkillTabs } from '../_components/skill-tabs'
import { useCanManage } from '../_components/use-can-manage'

type ProposalStatus = 'OPEN' | 'IN_REVIEW' | 'APPROVED' | 'MERGED' | 'REJECTED' | 'CLOSED'
type FilterTab = 'open' | 'closed' | 'all'

const STATUS_CONFIG: Record<ProposalStatus, { label: string; colour: string }> = {
  OPEN: {
    label: 'Open',
    colour: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  },
  IN_REVIEW: {
    label: 'In Review',
    colour: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  },
  APPROVED: {
    label: 'Approved',
    colour: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  },
  MERGED: {
    label: 'Merged',
    colour: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  },
  REJECTED: {
    label: 'Rejected',
    colour: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  },
  CLOSED: {
    label: 'Closed',
    colour: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  },
}

const OPEN_STATUSES = new Set<ProposalStatus>(['OPEN', 'IN_REVIEW', 'APPROVED'])
const CLOSED_STATUSES = new Set<ProposalStatus>(['MERGED', 'REJECTED', 'CLOSED'])

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

export default function SuggestionsListPage({
  params,
}: {
  params: Promise<{ org: string; name: string }>
}) {
  const { org, name } = use(params)
  const [activeTab, setActiveTab] = useState<FilterTab>('open')
  const { data: pkg, isLoading: pkgLoading } = trpc.skills.getBySlug.useQuery({ org, name })
  const canManage = useCanManage(org, pkg?.authorId)

  const { data: proposalsData, isLoading: proposalsLoading } = trpc.proposals.list.useQuery(
    { packageId: pkg?.id ?? '' },
    { enabled: !!pkg }
  )

  if (pkgLoading) {
    return <SkillPageSkeleton />
  }

  if (!pkg) {
    return <div className="py-16 text-center text-muted-foreground">Package not found</div>
  }

  const allProposals = proposalsData?.proposals ?? []
  const filteredProposals = allProposals.filter((p) => {
    const status = p.status as ProposalStatus
    if (activeTab === 'open') return OPEN_STATUSES.has(status)
    if (activeTab === 'closed') return CLOSED_STATUSES.has(status)
    return true
  })

  const openCount = allProposals.filter((p) => OPEN_STATUSES.has(p.status as ProposalStatus)).length
  const closedCount = allProposals.filter((p) =>
    CLOSED_STATUSES.has(p.status as ProposalStatus)
  ).length

  return (
    <div className="space-y-6">
      <SkillHeader pkg={pkg} org={org} name={name} canManage={canManage} />
      <SkillTabs org={org} name={name} canManage={canManage} />

      {/* Filter tabs */}
      <div className="flex gap-1 border-b">
        <FilterButton
          label="Open"
          count={openCount}
          isActive={activeTab === 'open'}
          onClick={() => setActiveTab('open')}
        />
        <FilterButton
          label="Closed"
          count={closedCount}
          isActive={activeTab === 'closed'}
          onClick={() => setActiveTab('closed')}
        />
        <FilterButton
          label="All"
          count={allProposals.length}
          isActive={activeTab === 'all'}
          onClick={() => setActiveTab('all')}
        />
      </div>

      {/* Proposals list */}
      {proposalsLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : filteredProposals.length === 0 ? (
        <div className="py-12 text-center">
          <MessageSquare className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-display font-medium">No suggestions</p>
          <p className="mt-1 text-muted-foreground text-sm">
            {activeTab === 'open'
              ? 'There are no open suggestions for this skill.'
              : activeTab === 'closed'
                ? 'There are no closed suggestions for this skill.'
                : 'There are no suggestions for this skill yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredProposals.map((proposal) => {
            const status = proposal.status as ProposalStatus
            const statusConfig = STATUS_CONFIG[status]
            return (
              <Link key={proposal.id} href={`/suggestions/${proposal.id}`}>
                <Card className="transition-colors hover:bg-muted/30">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-sm">{proposal.title}</span>
                        <Badge
                          className={cn('shrink-0 border-transparent text-xs', statusConfig.colour)}
                        >
                          {statusConfig.label}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
                        <span className="flex items-center gap-1">
                          {proposal.author.image ? (
                            <img
                              src={proposal.author.image}
                              alt=""
                              className="size-4 rounded-full"
                            />
                          ) : (
                            <div className="flex size-4 items-center justify-center rounded-full bg-muted text-xs">
                              {(proposal.author.name ?? '?')[0]}
                            </div>
                          )}
                          {proposal.author.name ?? 'Unknown'}
                        </span>
                        <span>opened {formatRelativeTime(proposal.createdAt)}</span>
                      </div>
                    </div>
                    {proposal._count.comments > 0 && (
                      <div className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
                        <MessageSquare className="size-3.5" />
                        {proposal._count.comments}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterButton({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string
  count: number
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 font-medium text-sm transition-colors',
        isActive
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground'
      )}
    >
      {label}
      <Badge variant="secondary" className="px-1.5 py-0 text-xs">
        {count}
      </Badge>
    </button>
  )
}
