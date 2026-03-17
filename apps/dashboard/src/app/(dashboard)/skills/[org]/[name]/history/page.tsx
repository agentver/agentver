'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@agentver/ui/components/card'
import { GitCommit } from 'lucide-react'
import { use } from 'react'
import { trpc } from '@/trpc/client'
import { SkillHeader } from '../_components/skill-header'
import { SkillPageSkeleton } from '../_components/skill-page-skeleton'
import { SkillTabs } from '../_components/skill-tabs'
import { useCanManage } from '../_components/use-can-manage'

function formatCommitDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: diffDays > 365 ? 'numeric' : undefined,
  })
}

export default function HistoryPage({
  params,
}: {
  params: Promise<{ org: string; name: string }>
}) {
  const { org, name } = use(params)
  const { data: pkg, isLoading: pkgLoading } = trpc.skills.getBySlug.useQuery({ org, name })
  const canManage = useCanManage(org, pkg?.authorId)

  const {
    data: commits,
    isLoading: historyLoading,
    error: historyError,
  } = trpc.git.getSkillHistory.useQuery({ org, name, limit: 50 })

  if (pkgLoading) {
    return <SkillPageSkeleton />
  }

  if (!pkg) {
    return <div className="py-16 text-center text-muted-foreground">Package not found</div>
  }

  return (
    <div className="space-y-6">
      <SkillHeader pkg={pkg} org={org} name={name} canManage={canManage} />
      <SkillTabs org={org} name={name} canManage={canManage} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Commit History</CardTitle>
          <p className="text-muted-foreground text-sm">Recent commits to the skill repository.</p>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <div className="h-4 w-4 animate-pulse rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : historyError ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>Unable to load commit history.</p>
              <p className="mt-1 text-xs">Ensure Forgejo is configured and the namespace exists.</p>
            </div>
          ) : !commits || commits.length === 0 ? (
            <div className="py-12 text-center">
              <GitCommit className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-display font-medium">No history yet</p>
              <p className="mt-1 text-muted-foreground text-sm">
                Commits will appear here once content is pushed to Git.
              </p>
            </div>
          ) : (
            <CommitTimeline commits={commits} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function CommitTimeline({
  commits,
}: {
  commits: Array<{
    sha: string
    message: string
    author: { name: string; email: string; date: string }
    createdAt: string
  }>
}) {
  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute top-2 bottom-2 left-[7px] w-px bg-border" />

      <div className="space-y-0">
        {commits.map((commit, index) => {
          const isFirst = index === 0
          const messageLines = commit.message.split('\n')
          const title = messageLines[0] ?? ''
          const body = messageLines.slice(1).join('\n').trim()

          return (
            <div key={commit.sha} className="relative flex gap-4 pb-6 last:pb-0">
              {/* Timeline dot */}
              <div className="relative z-10 mt-1.5 flex shrink-0">
                <div
                  className={`size-[15px] rounded-full border-2 ${
                    isFirst
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/30 bg-background'
                  }`}
                />
              </div>

              {/* Commit content */}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm leading-snug">{title}</p>

                {body && (
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed">
                    {body}
                  </p>
                )}

                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
                  <span className="font-mono">{commit.sha.slice(0, 7)}</span>
                  <span>{commit.author.name}</span>
                  <span>{formatCommitDate(commit.author.date)}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
