'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@agentver/ui/components/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentver/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@agentver/ui/components/dropdown-menu'
import { Textarea } from '@agentver/ui/components/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agentver/ui/components/tooltip'
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  GitBranch,
  GitCommit,
  MoreVertical,
  RotateCcw,
  ShieldAlert,
  Tag,
  XCircle,
} from 'lucide-react'
import { use, useState } from 'react'
import { trpc } from '@/trpc/client'
import { SkillHeader } from '../_components/skill-header'
import { SkillPageSkeleton } from '../_components/skill-page-skeleton'
import { SkillTabs } from '../_components/skill-tabs'
import { useCanManage } from '../_components/use-can-manage'

type VersionStatus = 'PUBLISHED' | 'DEPRECATED' | 'YANKED'

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function VersionsPage({
  params,
}: {
  params: Promise<{ org: string; name: string }>
}) {
  const { org, name } = use(params)
  const { data: pkg, isLoading: pkgLoading } = trpc.skills.getBySlug.useQuery({ org, name })
  const canManage = useCanManage(org, pkg?.authorId)

  const {
    data: versions,
    isLoading: versionsLoading,
    error: versionsError,
  } = trpc.git.getSkillVersions.useQuery({ org, name })

  if (pkgLoading) {
    return <SkillPageSkeleton />
  }

  if (!pkg) {
    return <div className="py-16 text-center text-muted-foreground">Package not found</div>
  }

  const latestVersionId = pkg.versions[0]?.id ?? null

  return (
    <div className="space-y-6">
      <SkillHeader pkg={pkg} org={org} name={name} canManage={canManage} />
      <SkillTabs org={org} name={name} canManage={canManage} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Published Versions</CardTitle>
          <p className="text-muted-foreground text-sm">
            Each version is created from a Git commit. Install a specific version using the version
            tag.
          </p>
        </CardHeader>
        <CardContent>
          {versionsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : versionsError ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>Unable to load versions.</p>
              <p className="mt-1 text-xs">Please try again later.</p>
            </div>
          ) : !versions || versions.length === 0 ? (
            <div className="py-12 text-center">
              <Tag className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-display font-medium">No versions yet</p>
              <p className="mt-1 text-muted-foreground text-sm">
                Versions are created when content is saved or published.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {versions.map((version) => (
                <VersionEntry
                  key={version.id}
                  version={version}
                  packageId={pkg.id}
                  org={org}
                  name={name}
                  isLatest={version.id === latestVersionId}
                  gitRepoUrl={pkg.gitRepoUrl}
                  canManage={canManage}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function VersionStatusBadge({
  status,
  changelog,
}: {
  status: VersionStatus
  changelog: string | null
}) {
  if (status === 'DEPRECATED') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
              <AlertTriangle className="mr-1 size-3" />
              Deprecated
            </Badge>
          </TooltipTrigger>
          {changelog && (
            <TooltipContent>
              <p className="max-w-xs">{changelog}</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    )
  }

  if (status === 'YANKED') {
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
        <XCircle className="mr-1 size-3" />
        Yanked
      </Badge>
    )
  }

  return null
}

function VersionEntry({
  version,
  packageId,
  org,
  name,
  isLatest,
  gitRepoUrl,
  canManage,
}: {
  version: {
    id: string
    version: string
    changelog: string | null
    status: VersionStatus
    createdAt: Date | string
    gitRef: string | null
    gitCommitSha: string | null
  }
  packageId: string
  org: string
  name: string
  isLatest: boolean
  gitRepoUrl: string | null
  canManage: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [deprecateOpen, setDeprecateOpen] = useState(false)
  const [yankOpen, setYankOpen] = useState(false)
  const [deprecationMessage, setDeprecationMessage] = useState('')

  const utils = trpc.useUtils()

  const deprecateMutation = trpc.skills.deprecateVersion.useMutation({
    onSuccess: () => {
      setDeprecateOpen(false)
      setDeprecationMessage('')
      utils.git.getSkillVersions.invalidate({ org, name })
      utils.skills.getBySlug.invalidate({ org, name })
    },
  })

  const yankMutation = trpc.skills.yankVersion.useMutation({
    onSuccess: () => {
      setYankOpen(false)
      utils.git.getSkillVersions.invalidate({ org, name })
      utils.skills.getBySlug.invalidate({ org, name })
    },
  })

  const restoreMutation = trpc.skills.restoreVersion.useMutation({
    onSuccess: () => {
      utils.git.getSkillVersions.invalidate({ org, name })
      utils.skills.getBySlug.invalidate({ org, name })
    },
  })

  const installCommand = `agentver install ${org}/${name}@v${version.version}`
  const commitUrl =
    gitRepoUrl && version.gitCommitSha ? `${gitRepoUrl}/commit/${version.gitCommitSha}` : null

  const isPublished = version.status === 'PUBLISHED'
  const isDeprecated = version.status === 'DEPRECATED'
  const isYanked = version.status === 'YANKED'

  const handleCopy = async () => {
    await navigator.clipboard.writeText(installCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDeprecate = () => {
    deprecateMutation.mutate({
      packageId,
      versionId: version.id,
      ...(deprecationMessage.trim() && { message: deprecationMessage.trim() }),
    })
  }

  const handleYank = () => {
    yankMutation.mutate({ packageId, versionId: version.id })
  }

  const handleRestore = () => {
    restoreMutation.mutate({ packageId, versionId: version.id })
  }

  return (
    <>
      <div
        className={`flex items-start justify-between rounded-lg border p-4 ${
          isYanked ? 'opacity-60' : isDeprecated ? 'border-amber-200 dark:border-amber-800/50' : ''
        }`}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium font-mono">v{version.version}</span>
            {isLatest && isPublished && (
              <Badge className="bg-emerald-100 text-emerald-800">latest</Badge>
            )}
            <VersionStatusBadge status={version.status} changelog={version.changelog} />
            {version.gitRef && (
              <Badge variant="outline" className="font-mono text-xs">
                <GitBranch className="mr-1 size-3" />
                {version.gitRef}
              </Badge>
            )}
          </div>

          {version.changelog && isPublished && (
            <p className="text-muted-foreground text-sm">{version.changelog}</p>
          )}

          {version.gitCommitSha && (
            <div className="flex items-center gap-1 text-muted-foreground text-xs">
              <GitCommit className="size-3" />
              {commitUrl ? (
                <a
                  href={commitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono hover:text-primary hover:underline"
                >
                  {version.gitCommitSha.slice(0, 7)}
                </a>
              ) : (
                <span className="font-mono">{version.gitCommitSha.slice(0, 7)}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="text-muted-foreground text-xs">{formatDate(version.createdAt)}</span>
          {!isYanked && (
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? (
                <Check className="mr-1 size-3.5 text-emerald-500" />
              ) : (
                <ClipboardCopy className="mr-1 size-3.5" />
              )}
              {copied ? 'Copied' : 'Install'}
            </Button>
          )}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="size-8 p-0">
                  <MoreVertical className="size-4" />
                  <span className="sr-only">Version actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isPublished && (
                  <>
                    <DropdownMenuItem onClick={() => setDeprecateOpen(true)}>
                      <AlertTriangle className="mr-2 size-4 text-amber-500" />
                      Deprecate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setYankOpen(true)}
                      className="text-destructive focus:text-destructive"
                    >
                      <ShieldAlert className="mr-2 size-4" />
                      Yank
                    </DropdownMenuItem>
                  </>
                )}
                {(isDeprecated || isYanked) && (
                  <DropdownMenuItem onClick={handleRestore} disabled={restoreMutation.isPending}>
                    <RotateCcw className="mr-2 size-4" />
                    Restore
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <Dialog open={deprecateOpen} onOpenChange={setDeprecateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deprecate v{version.version}</DialogTitle>
            <DialogDescription>
              Deprecated versions are still installable but will show a warning. You can add an
              optional message explaining why this version is deprecated.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Optional deprecation message..."
            value={deprecationMessage}
            onChange={(e) => setDeprecationMessage(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="default"
              className="bg-amber-600 hover:bg-amber-700"
              onClick={handleDeprecate}
              disabled={deprecateMutation.isPending}
            >
              {deprecateMutation.isPending ? 'Deprecating...' : 'Deprecate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={yankOpen} onOpenChange={setYankOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yank v{version.version}</DialogTitle>
            <DialogDescription>
              Yanked versions are hidden from install commands but still visible in the version
              history. This is typically used for versions with critical bugs or security issues.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleYank} disabled={yankMutation.isPending}>
              {yankMutation.isPending ? 'Yanking...' : 'Yank version'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
