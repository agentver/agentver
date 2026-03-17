'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import { Card, CardContent } from '@agentver/ui/components/card'
import { cn } from '@agentver/ui-utils'
import { ArrowDownToLine, GitFork, RefreshCw, SendHorizonal } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { trpc } from '@/trpc/client'
import { SyncDialog } from './sync-dialog'

type UpstreamStatusProps = {
  packageId: string
  forkedFrom: {
    name: string
    organisation: { slug: string }
  }
}

export function UpstreamStatus({ packageId, forkedFrom }: UpstreamStatusProps) {
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)

  const {
    data: updateStatus,
    isLoading,
    refetch,
  } = trpc.forks.checkUpstreamUpdates.useQuery({ packageId })

  const proposalMutation = trpc.forks.createUpstreamProposal.useMutation()
  const utils = trpc.useUtils()

  const handleProposeChanges = () => {
    proposalMutation.mutate(
      { packageId },
      {
        onSuccess: () => {
          utils.forks.checkUpstreamUpdates.invalidate({ packageId })
        },
      }
    )
  }

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-3">
          <div className="flex items-center gap-2">
            <GitFork className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground text-sm">
              Forked from{' '}
              <Link
                href={`/skills/${forkedFrom.organisation.slug}/${forkedFrom.name}`}
                className="font-medium text-foreground hover:underline"
              >
                {forkedFrom.organisation.slug}/{forkedFrom.name}
              </Link>
            </span>
            <div className="ml-auto h-4 w-24 animate-pulse rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    )
  }

  const hasUpdates = updateStatus?.hasUpdates ?? false
  const updateCount = updateStatus?.upstreamVersions.length ?? 0

  return (
    <>
      <Card
        className={cn(
          'border',
          hasUpdates
            ? 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20'
            : 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20'
        )}
      >
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-2">
            <GitFork
              className={cn('h-4 w-4', hasUpdates ? 'text-amber-600' : 'text-emerald-600')}
            />
            <span className="text-sm">
              Forked from{' '}
              <Link
                href={`/skills/${forkedFrom.organisation.slug}/${forkedFrom.name}`}
                className="font-medium hover:underline"
              >
                {forkedFrom.organisation.slug}/{forkedFrom.name}
              </Link>
            </span>

            {hasUpdates ? (
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
              >
                {updateCount} new version{updateCount !== 1 ? 's' : ''} available
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
              >
                Up to date
              </Badge>
            )}

            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetch()}
                className="h-7 gap-1 text-xs"
              >
                <RefreshCw className="h-3 w-3" />
                Check for updates
              </Button>

              {hasUpdates && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSyncDialogOpen(true)}
                  className="h-7 gap-1 border-amber-300 text-xs hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/50"
                >
                  <ArrowDownToLine className="h-3 w-3" />
                  Sync from original
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={handleProposeChanges}
                disabled={proposalMutation.isPending}
                className="h-7 gap-1 text-xs"
              >
                <SendHorizonal className="h-3 w-3" />
                {proposalMutation.isPending
                  ? 'Suggesting...'
                  : proposalMutation.isSuccess
                    ? 'Suggested!'
                    : 'Suggest changes to original'}
              </Button>
            </div>
          </div>

          {hasUpdates && updateStatus && (
            <div className="mt-2 space-y-1 border-amber-200 border-t pt-2 dark:border-amber-800">
              <p className="font-medium text-amber-800 text-xs dark:text-amber-300">
                The original package has been updated. Your copy is on v
                {updateStatus.currentVersion}, upstream is at v{updateStatus.upstreamLatestVersion}.
              </p>
              <div className="space-y-0.5">
                {updateStatus.upstreamVersions.slice(0, 3).map((v) => (
                  <p key={v.version} className="text-amber-700 text-xs dark:text-amber-400">
                    v{v.version}
                    {v.changelog ? ` — ${v.changelog}` : ''}
                  </p>
                ))}
                {updateStatus.upstreamVersions.length > 3 && (
                  <p className="text-amber-600 text-xs dark:text-amber-500">
                    and {updateStatus.upstreamVersions.length - 3} more...
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <SyncDialog packageId={packageId} open={syncDialogOpen} onOpenChange={setSyncDialogOpen} />
    </>
  )
}
