'use client'

import { Button } from '@agentver/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@agentver/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentver/ui/components/dialog'
import { ExternalLink, GitBranch, Link2Off, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/trpc/client'
import { SkillsRepoConnectDialog } from './skills-repo-connect-dialog'

type SkillsRepoCardProps = {
  organisationId: string
  skillsRepoUrl: string | null
  skillsRepoOwner: string | null
  skillsRepoName: string | null
  skillsRepoProvider: string | null
  canManage: boolean
  onRefetch: () => void
}

export function SkillsRepoCard({
  organisationId,
  skillsRepoUrl,
  skillsRepoOwner,
  skillsRepoName,
  skillsRepoProvider,
  canManage,
  onRefetch,
}: SkillsRepoCardProps) {
  const [connectOpen, setConnectOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const isAgentver = skillsRepoProvider === 'agentver'
  const isConnected = !!(skillsRepoUrl && (isAgentver || (skillsRepoOwner && skillsRepoName)))

  const disconnectRepo = trpc.organisations.disconnectSkillsRepo.useMutation({
    onSuccess: () => {
      toast.success('Package repository disconnected')
      setDisconnectOpen(false)
      onRefetch()
    },
    onError: (error) => toast.error(error.message),
  })

  if (!isConnected) {
    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Package Repository
            </CardTitle>
            <CardDescription>
              Connect a GitHub repository to store your organisation&apos;s packages. This is
              required for the git-native workflow — imported packages are committed directly to
              your repository.
            </CardDescription>
          </CardHeader>
          {canManage && (
            <CardContent>
              <Button onClick={() => setConnectOpen(true)}>
                <GitBranch className="mr-2 h-4 w-4" />
                Connect Repository
              </Button>
            </CardContent>
          )}
        </Card>
        <SkillsRepoConnectDialog
          open={connectOpen}
          onOpenChange={setConnectOpen}
          organisationId={organisationId}
          onConnected={onRefetch}
        />
      </>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                Package Repository
              </CardTitle>
              <CardDescription>
                Your organisation&apos;s packages are stored in this repository.
              </CardDescription>
            </div>
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setDisconnectOpen(true)}>
                <Link2Off className="mr-2 h-4 w-4" />
                Disconnect
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="font-medium text-sm">
                {isAgentver ? 'Agentver Built-in Storage' : `${skillsRepoOwner}/${skillsRepoName}`}
              </p>
              <p className="text-muted-foreground text-xs">
                Provider: {isAgentver ? 'Agentver' : (skillsRepoProvider ?? 'github')}
              </p>
            </div>
            {!isAgentver && skillsRepoUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={skillsRepoUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View on GitHub
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Package Repository</DialogTitle>
            <DialogDescription>
              Are you sure you want to disconnect{' '}
              <strong>
                {isAgentver ? 'Agentver Built-in Storage' : `${skillsRepoOwner}/${skillsRepoName}`}
              </strong>
              ? Existing packages will remain, but new imports will not be committed to a repository
              until you connect a new one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => disconnectRepo.mutate({ organisationId })}
              disabled={disconnectRepo.isPending}
            >
              {disconnectRepo.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {disconnectRepo.isPending ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
