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
import { Separator } from '@agentver/ui/components/separator'
import { cn } from '@agentver/ui-utils'
import { ArrowDownToLine, ArrowRight } from 'lucide-react'
import { trpc } from '@/trpc/client'

type SyncDialogProps = {
  packageId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SyncDialog({ packageId, open, onOpenChange }: SyncDialogProps) {
  const { data: diff, isLoading } = trpc.forks.getUpstreamDiff.useQuery(
    { packageId },
    { enabled: open }
  )

  const syncMutation = trpc.forks.syncFromUpstream.useMutation()
  const utils = trpc.useUtils()

  const handleSync = () => {
    syncMutation.mutate(
      { packageId },
      {
        onSuccess: () => {
          utils.skills.getBySlug.invalidate()
          utils.forks.checkUpstreamUpdates.invalidate({ packageId })
          onOpenChange(false)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sync from original</DialogTitle>
          <DialogDescription>
            This will update your copy with the latest changes from the original. Your custom
            changes will be preserved as a new version.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-32 animate-pulse rounded bg-muted" />
          </div>
        ) : diff ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 text-sm">
              <div className="rounded-md border bg-muted/50 px-3 py-1.5">
                <span className="text-muted-foreground">Your version: </span>
                <span className="font-medium font-mono">v{diff.forkVersion}</span>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <div className="rounded-md border bg-muted/50 px-3 py-1.5">
                <span className="text-muted-foreground">Original version: </span>
                <span className="font-medium font-mono">v{diff.upstreamVersion}</span>
              </div>
            </div>

            <Separator />

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 font-medium text-muted-foreground text-xs">
                  Your current content
                </p>
                <div
                  className={cn(
                    'max-h-64 overflow-auto rounded-md border bg-muted/30 p-3',
                    'font-mono text-xs leading-relaxed'
                  )}
                >
                  <pre className="whitespace-pre-wrap">{diff.forkContent || '(empty)'}</pre>
                </div>
              </div>
              <div>
                <p className="mb-2 font-medium text-muted-foreground text-xs">
                  Original&apos;s latest content
                </p>
                <div
                  className={cn(
                    'max-h-64 overflow-auto rounded-md border bg-muted/30 p-3',
                    'font-mono text-xs leading-relaxed'
                  )}
                >
                  <pre className="whitespace-pre-wrap">{diff.upstreamContent || '(empty)'}</pre>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-800 text-sm dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
              Syncing will replace your content with the original&apos;s latest version and create a
              new version on your fork. This action cannot be undone.
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground text-sm">
            Unable to load comparison data.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSync} disabled={!diff || syncMutation.isPending} className="gap-1">
            <ArrowDownToLine className="h-4 w-4" />
            {syncMutation.isPending ? 'Syncing...' : 'Sync now'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
