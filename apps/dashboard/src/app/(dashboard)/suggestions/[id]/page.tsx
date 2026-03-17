'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@agentver/ui/components/tabs'
import { cn } from '@agentver/ui-utils'
import { FileCode, GitBranch, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { use } from 'react'
import { trpc } from '@/trpc/client'
import { ActionButtons } from './_components/action-buttons'
import { Conversation } from './_components/conversation'
import { DiffViewer } from './_components/diff-viewer'
import { ReviewForm } from './_components/review-form'

type ProposalStatus = 'OPEN' | 'IN_REVIEW' | 'APPROVED' | 'MERGED' | 'REJECTED' | 'CLOSED'

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

type DiffFile = {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  hunks: {
    header: string
    lines: {
      type: 'add' | 'delete' | 'context'
      content: string
      oldLineNumber: number | null
      newLineNumber: number | null
    }[]
  }[]
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

export default function SuggestionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: proposal, isLoading, error } = trpc.proposals.getById.useQuery({ id })
  const { data: diffData } = trpc.proposals.getDiff.useQuery(
    { proposalId: id },
    { enabled: !!proposal }
  )

  if (isLoading) {
    return <SuggestionDetailSkeleton />
  }

  if (error || !proposal) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        {error?.message ?? 'Suggestion not found'}
      </div>
    )
  }

  const status = proposal.status as ProposalStatus
  const statusConfig = STATUS_CONFIG[status]
  const diffStat = proposal.diffStat as {
    additions?: number
    deletions?: number
    filesChanged?: number
  } | null
  const diffFiles: DiffFile[] = diffData?.files ?? []

  const totalAdditions =
    diffFiles.length > 0
      ? diffFiles.reduce((sum, f) => sum + f.additions, 0)
      : (diffStat?.additions ?? 0)
  const totalDeletions =
    diffFiles.length > 0
      ? diffFiles.reduce((sum, f) => sum + f.deletions, 0)
      : (diffStat?.deletions ?? 0)
  const filesChanged = diffFiles.length > 0 ? diffFiles.length : (diffStat?.filesChanged ?? 0)

  const orgSlug = proposal.package.organisation.slug
  const skillName = proposal.package.name

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-muted-foreground text-sm">
        <Link href={`/skills/${orgSlug}/${skillName}`} className="hover:text-foreground">
          @{orgSlug}/{skillName}
        </Link>
        {' / '}
        <Link
          href={`/skills/${orgSlug}/${skillName}/suggestions`}
          className="hover:text-foreground"
        >
          Suggestions
        </Link>
      </nav>

      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="font-display font-semibold text-2xl">{proposal.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <Badge className={cn('border-transparent', statusConfig.colour)}>
                {statusConfig.label}
              </Badge>
              <div className="flex items-center gap-1 text-muted-foreground">
                {proposal.author.image ? (
                  <img src={proposal.author.image} alt="" className="size-5 rounded-full" />
                ) : (
                  <div className="flex size-5 items-center justify-center rounded-full bg-muted font-medium text-xs">
                    {(proposal.author.name ?? '?')[0]}
                  </div>
                )}
                <span>{proposal.author.name ?? 'Unknown'}</span>
                <span className="text-muted-foreground">
                  opened {formatRelativeTime(proposal.createdAt)}
                </span>
              </div>
            </div>
          </div>

          <ActionButtons
            proposalId={proposal.id}
            status={proposal.status}
            permissions={proposal.permissions}
          />
        </div>

        {/* Branch info + stats */}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <GitBranch className="size-3.5" />
            <Badge variant="outline" className="font-mono text-xs">
              {proposal.targetBranch}
            </Badge>
            <span>&larr;</span>
            <Badge variant="outline" className="font-mono text-xs">
              {proposal.sourceBranch ?? 'suggestion'}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <span className="text-green-700 dark:text-green-400">+{totalAdditions}</span>
            <span className="text-red-700 dark:text-red-400">-{totalDeletions}</span>
            <span>
              {filesChanged} file{filesChanged !== 1 ? 's' : ''} changed
            </span>
          </div>
        </div>

        {proposal.description && (
          <p className="max-w-3xl text-muted-foreground text-sm">{proposal.description}</p>
        )}
      </div>

      {/* Tabs: Conversation / Files Changed */}
      <Tabs defaultValue="conversation">
        <TabsList>
          <TabsTrigger value="conversation" className="gap-1.5">
            <MessageSquare className="size-3.5" />
            Conversation
            {proposal.comments.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                {proposal.comments.filter((c) => !c.filePath).length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="files" className="gap-1.5">
            <FileCode className="size-3.5" />
            Files Changed
            {filesChanged > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                {filesChanged}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conversation">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Conversation
                proposalId={proposal.id}
                comments={proposal.comments}
                reviews={proposal.reviews}
                status={proposal.status}
                createdAt={proposal.createdAt}
                mergedAt={proposal.mergedAt}
                closedAt={proposal.closedAt}
                authorName={proposal.author.name}
              />
            </div>
            <div>
              <ReviewForm proposalId={proposal.id} canReview={proposal.permissions.canReview} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="files">
          <DiffViewer files={diffFiles} proposalId={proposal.id} comments={proposal.comments} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SuggestionDetailSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-4 w-48 rounded bg-muted" />
      <div className="space-y-3">
        <div className="h-8 w-96 rounded bg-muted" />
        <div className="flex gap-3">
          <div className="h-6 w-16 rounded-full bg-muted" />
          <div className="h-6 w-32 rounded bg-muted" />
        </div>
      </div>
      <div className="h-10 w-64 rounded bg-muted" />
      <div className="h-64 rounded-lg bg-muted" />
    </div>
  )
}
