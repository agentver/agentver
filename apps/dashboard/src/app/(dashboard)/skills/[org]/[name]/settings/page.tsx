'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@agentver/ui/components/card'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agentver/ui/components/select'
import { Textarea } from '@agentver/ui/components/textarea'
import {
  AlertTriangle,
  Archive,
  Copy,
  ExternalLink,
  GitCompareArrows,
  Link as LinkIcon,
  Loader2,
  Pencil,
  RotateCcw,
  Shield,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { use, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/trpc/client'
import { SkillHeader } from '../_components/skill-header'
import { SkillPageSkeleton } from '../_components/skill-page-skeleton'
import { SkillTabs } from '../_components/skill-tabs'
import { useCanManage } from '../_components/use-can-manage'

type Visibility = 'PUBLIC' | 'PRIVATE' | 'TEAM'

const VISIBILITY_OPTIONS: Array<{ value: Visibility; label: string; description: string }> = [
  { value: 'PUBLIC', label: 'Public', description: 'Anyone can view and install this package.' },
  {
    value: 'PRIVATE',
    label: 'Private',
    description: 'Only organisation members can view and install.',
  },
  {
    value: 'TEAM',
    label: 'Team',
    description: 'Only team members within the organisation can access.',
  },
]

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  ACTIVE: {
    label: 'Active',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  },
  ARCHIVED: {
    label: 'Archived',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  },
  DEPRECATED: {
    label: 'Deprecated',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  },
}

export default function SkillSettingsPage({
  params,
}: {
  params: Promise<{ org: string; name: string }>
}) {
  const { org, name } = use(params)
  const router = useRouter()
  const utils = trpc.useUtils()

  const { data: pkg, isLoading: pkgLoading } = trpc.skills.getBySlug.useQuery({ org, name })
  const canManage = useCanManage(org, pkg?.authorId)

  const updateMutation = trpc.skills.update.useMutation({
    onSuccess: () => {
      toast.success('Settings updated')
      utils.skills.getBySlug.invalidate({ org, name })
    },
    onError: (error) => {
      toast.error('Failed to update settings', { description: error.message })
    },
  })

  const archiveMutation = trpc.skills.archive.useMutation({
    onSuccess: () => {
      toast.success('Package archived')
      utils.skills.getBySlug.invalidate({ org, name })
    },
    onError: (error) => {
      toast.error('Failed to archive package', { description: error.message })
    },
  })

  const deprecateMutation = trpc.skills.deprecate.useMutation({
    onSuccess: () => {
      toast.success('Package deprecated')
      utils.skills.getBySlug.invalidate({ org, name })
    },
    onError: (error) => {
      toast.error('Failed to deprecate package', { description: error.message })
    },
  })

  const activateMutation = trpc.skills.activate.useMutation({
    onSuccess: () => {
      toast.success('Package restored')
      utils.skills.getBySlug.invalidate({ org, name })
    },
    onError: (error) => {
      toast.error('Failed to restore package', { description: error.message })
    },
  })

  const deleteMutation = trpc.skills.delete.useMutation()

  const accounts = trpc.connections.list.useQuery(undefined, { enabled: canManage })
  const hasGitHubAccount = accounts.data?.some((a) => a.provider === 'GITHUB') ?? false

  const enableSyncMutation = trpc.imports.enableGitHubSync.useMutation({
    onSuccess: () => {
      toast.success('Mirror sync enabled')
      utils.skills.getBySlug.invalidate({ org, name })
    },
    onError: (error) => {
      toast.error('Failed to enable sync', { description: error.message })
    },
  })

  const disableSyncMutation = trpc.imports.disableGitHubSync.useMutation({
    onSuccess: () => {
      toast.success('Mirror sync disabled')
      utils.skills.getBySlug.invalidate({ org, name })
    },
    onError: (error) => {
      toast.error('Failed to disable sync', { description: error.message })
    },
  })

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
  const [deprecateDialogOpen, setDeprecateDialogOpen] = useState(false)
  const [deprecationNote, setDeprecationNote] = useState('')

  const isForgejoBacked = pkg?.gitUri?.startsWith('agentver://') ?? false
  const isGitHubBacked = pkg?.gitUri?.includes('github.com') ?? false
  const hasSource = !!pkg?.gitUri && !isForgejoBacked

  const adoptionMode = useMemo(() => {
    if (pkg?.tags.includes('mirrored')) return 'MIRROR' as const
    if (pkg?.tags.includes('linked')) return 'LINK' as const
    return 'COPY' as const
  }, [pkg?.tags])

  const gitHubOwnerRepo = useMemo(() => {
    if (!isGitHubBacked || !pkg?.gitUri) return null
    const cleaned = pkg.gitUri.replace(/^https?:\/\//, '').replace(/^github\.com\//, '')
    const parts = cleaned.split('/')
    if (parts.length >= 2) return { owner: parts[0]!, repo: parts[1]! }
    return null
  }, [isGitHubBacked, pkg?.gitUri])

  if (pkgLoading) {
    return <SkillPageSkeleton />
  }

  if (!pkg) {
    return <div className="py-16 text-center text-muted-foreground">Package not found</div>
  }

  if (!canManage) {
    return (
      <div className="space-y-6">
        <SkillHeader pkg={pkg} org={org} name={name} />
        <SkillTabs org={org} name={name} />
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
            <Shield className="size-5 text-muted-foreground" />
          </div>
          <h3 className="mt-4 font-display font-semibold text-lg">
            You don&apos;t have permission to manage this package
          </h3>
          <p className="mt-1 max-w-sm text-muted-foreground text-sm">
            Only the package author or organisation owners and admins can access settings.
          </p>
        </div>
      </div>
    )
  }

  const expectedDeleteConfirmation = `${org}/${pkg.name}`
  const statusStyle = STATUS_STYLES[pkg.status] ?? STATUS_STYLES.ACTIVE!
  const isStatusMutating =
    archiveMutation.isPending || deprecateMutation.isPending || activateMutation.isPending

  const handleVisibilityChange = (visibility: Visibility) => {
    updateMutation.mutate({ id: pkg.id, visibility })
  }

  const handleArchiveConfirm = () => {
    archiveMutation.mutate({ id: pkg.id }, { onSuccess: () => setArchiveDialogOpen(false) })
  }

  const handleDeprecateConfirm = () => {
    deprecateMutation.mutate(
      { id: pkg.id, note: deprecationNote || undefined },
      {
        onSuccess: () => {
          setDeprecateDialogOpen(false)
          setDeprecationNote('')
        },
      }
    )
  }

  const handleActivate = () => {
    activateMutation.mutate({ id: pkg.id })
  }

  const handleDeleteConfirm = () => {
    if (deleteConfirmation !== expectedDeleteConfirmation) return

    deleteMutation.mutate(
      { id: pkg.id },
      {
        onSuccess: () => {
          toast.success('Package deleted', {
            description: `${expectedDeleteConfirmation} has been permanently deleted.`,
          })
          router.push('/skills')
        },
        onError: (error) => {
          toast.error('Failed to delete package', { description: error.message })
        },
      }
    )
  }

  return (
    <div className="space-y-6">
      <SkillHeader pkg={pkg} org={org} name={name} canManage={canManage} />
      <SkillTabs org={org} name={name} canManage={canManage} />

      {/* General Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Visibility */}
          <div className="space-y-2">
            <Label htmlFor="visibility">Visibility</Label>
            <Select
              value={pkg.visibility}
              onValueChange={(value) => handleVisibilityChange(value as Visibility)}
              disabled={updateMutation.isPending}
            >
              <SelectTrigger id="visibility" className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-sm">
              {VISIBILITY_OPTIONS.find((o) => o.value === pkg.visibility)?.description}
            </p>
          </div>

          {/* Edit content link */}
          <div className="space-y-2">
            <Label>Content</Label>
            <div>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/skills/${org}/${name}/edit`}>
                  <Pencil className="mr-1.5 size-3.5" />
                  Edit content
                  <ExternalLink className="ml-1.5 size-3" />
                </Link>
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">
              Open the editor to modify the SKILL.md content and metadata.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Source & Sync */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Source &amp; Sync</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasSource ? (
            <>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Label>Import mode</Label>
                  <Badge
                    className={
                      adoptionMode === 'MIRROR'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                        : adoptionMode === 'LINK'
                          ? 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                    }
                  >
                    {adoptionMode === 'MIRROR' && <GitCompareArrows className="mr-1 size-3" />}
                    {adoptionMode === 'LINK' && <LinkIcon className="mr-1 size-3" />}
                    {adoptionMode === 'COPY' && <Copy className="mr-1 size-3" />}
                    {adoptionMode}
                  </Badge>
                </div>

                <div className="rounded-lg border p-3 text-sm">
                  <dl className="space-y-1.5">
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-muted-foreground">Source</dt>
                      <dd className="truncate font-mono text-xs">{pkg.gitUri}</dd>
                    </div>
                    {pkg.gitPath && (
                      <div className="flex gap-2">
                        <dt className="shrink-0 text-muted-foreground">Path</dt>
                        <dd className="truncate font-mono text-xs">{pkg.gitPath}</dd>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-muted-foreground">Ref</dt>
                      <dd className="font-mono text-xs">{pkg.gitDefaultRef}</dd>
                    </div>
                  </dl>
                </div>

                {pkg.gitRepoUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={pkg.gitRepoUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-1.5 size-3" />
                      View source repository
                    </a>
                  </Button>
                )}
              </div>

              {/* Sync actions */}
              {isGitHubBacked && gitHubOwnerRepo && (
                <div className="space-y-2 border-t pt-4">
                  {adoptionMode === 'COPY' && hasGitHubAccount && (
                    <>
                      <p className="text-muted-foreground text-sm">
                        Enable mirror sync to automatically detect upstream changes and review
                        updates.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          enableSyncMutation.mutate({
                            repoOwner: gitHubOwnerRepo.owner,
                            repoName: gitHubOwnerRepo.repo,
                          })
                        }
                        disabled={enableSyncMutation.isPending}
                      >
                        {enableSyncMutation.isPending ? (
                          <>
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            Enabling...
                          </>
                        ) : (
                          <>
                            <GitCompareArrows className="mr-1.5 size-3.5" />
                            Enable mirror sync
                          </>
                        )}
                      </Button>
                    </>
                  )}
                  {adoptionMode === 'COPY' && !hasGitHubAccount && (
                    <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-blue-500" />
                      <div>
                        <p className="text-sm">
                          Connect your GitHub account to enable mirror sync for this package.
                        </p>
                        <Button variant="outline" size="sm" className="mt-2" asChild>
                          <Link href="/settings/connections">
                            <ExternalLink className="mr-1.5 size-3" />
                            Connect GitHub
                          </Link>
                        </Button>
                      </div>
                    </div>
                  )}
                  {adoptionMode === 'MIRROR' && (
                    <>
                      <p className="text-muted-foreground text-sm">
                        Mirror sync is active. Upstream changes are automatically detected.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          disableSyncMutation.mutate({
                            repoOwner: gitHubOwnerRepo.owner,
                            repoName: gitHubOwnerRepo.repo,
                          })
                        }
                        disabled={disableSyncMutation.isPending}
                      >
                        {disableSyncMutation.isPending ? (
                          <>
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            Disabling...
                          </>
                        ) : (
                          'Disable sync'
                        )}
                      </Button>
                    </>
                  )}
                  {adoptionMode === 'LINK' && (
                    <p className="text-muted-foreground text-sm">
                      This package is linked to its source. Content is fetched on demand — no local
                      copy is stored.
                    </p>
                  )}
                </div>
              )}
            </>
          ) : isForgejoBacked ? (
            <p className="text-muted-foreground text-sm">
              This package is stored in the organisation&apos;s internal repository. Source sync is
              managed automatically.
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              No external source linked. This package was created directly or imported as a copy
              without source tracking.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Package Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Package Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Label>Current status</Label>
            <Badge className={statusStyle.className}>{statusStyle.label}</Badge>
          </div>

          {pkg.status === 'ACTIVE' && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setArchiveDialogOpen(true)}
                disabled={isStatusMutating}
              >
                <Archive className="mr-1.5 size-3.5" />
                Archive
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeprecateDialogOpen(true)}
                disabled={isStatusMutating}
              >
                <AlertTriangle className="mr-1.5 size-3.5" />
                Deprecate
              </Button>
            </div>
          )}

          {pkg.status === 'ARCHIVED' && (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleActivate}
                disabled={isStatusMutating}
              >
                <RotateCcw className="mr-1.5 size-3.5" />
                {activateMutation.isPending ? 'Restoring...' : 'Restore'}
              </Button>
            </div>
          )}

          {pkg.status === 'DEPRECATED' && (
            <div className="space-y-3">
              {pkg.deprecationNote && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-800 text-sm dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                  {pkg.deprecationNote}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleActivate}
                disabled={isStatusMutating}
              >
                <RotateCcw className="mr-1.5 size-3.5" />
                {activateMutation.isPending ? 'Removing deprecation...' : 'Remove deprecation'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive text-sm">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-destructive/30 p-4">
            <div>
              <p className="font-medium text-sm">Delete this package</p>
              <p className="text-muted-foreground text-sm">
                Once deleted, all versions and installation records will be permanently removed.
              </p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="mr-1.5 size-3.5" />
              Delete package
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Archive Confirmation Dialog */}
      <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive package</DialogTitle>
            <DialogDescription>
              Archived packages are hidden from public listings but remain accessible via direct
              URL. You can restore them at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleArchiveConfirm} disabled={archiveMutation.isPending}>
              {archiveMutation.isPending ? 'Archiving...' : 'Archive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deprecate Confirmation Dialog */}
      <Dialog
        open={deprecateDialogOpen}
        onOpenChange={(open) => {
          setDeprecateDialogOpen(open)
          if (!open) setDeprecationNote('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deprecate package</DialogTitle>
            <DialogDescription>
              Deprecated packages show a warning banner to users. Provide a note explaining why and
              what to use instead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="deprecation-note">Deprecation note (optional)</Label>
            <Textarea
              id="deprecation-note"
              value={deprecationNote}
              onChange={(e) => setDeprecationNote(e.target.value)}
              placeholder="e.g. Use @org/new-package instead"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeprecateDialogOpen(false)
                setDeprecationNote('')
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleDeprecateConfirm} disabled={deprecateMutation.isPending}>
              {deprecateMutation.isPending ? 'Deprecating...' : 'Deprecate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) setDeleteConfirmation('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete package</DialogTitle>
            <DialogDescription>
              This will permanently delete{' '}
              <strong className="text-foreground">{expectedDeleteConfirmation}</strong>, all
              versions, and all installation records. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="settings-delete-confirmation">
              Type <strong>{expectedDeleteConfirmation}</strong> to confirm
            </Label>
            <Input
              id="settings-delete-confirmation"
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder={expectedDeleteConfirmation}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false)
                setDeleteConfirmation('')
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={
                deleteConfirmation !== expectedDeleteConfirmation || deleteMutation.isPending
              }
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete package'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
