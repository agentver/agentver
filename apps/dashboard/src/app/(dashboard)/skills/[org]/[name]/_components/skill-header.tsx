'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import {
  Dialog,
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
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import { cn } from '@agentver/ui-utils'
import {
  Check,
  ClipboardCopy,
  ExternalLink,
  GitBranch,
  GitFork,
  Monitor,
  MoreVertical,
  Pencil,
  Settings,
  Star,
  Terminal,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { StarButton } from '@/components/star-button'
import { AGENT_DISPLAY, type AgentDisplayInfo } from '@/lib/agent-display'
import { PACKAGE_TYPE_DISPLAY } from '@/lib/package-types'
import { trpc } from '@/trpc/client'

type SkillHeaderProps = {
  pkg: {
    id: string
    name: string
    slug: string
    type: string
    description: string | null
    tags: string[]
    gitUri: string | null
    gitPath: string | null
    gitDefaultRef: string
    gitRepoUrl: string | null
    readme: string | null
    compatibilityAgents: string[]
    organisation: {
      slug: string
      name: string
      id: string
    }
    author: { name: string | null; image: string | null } | null
    versions: Array<{
      id: string
      version: string
      changelog: string | null
      createdAt: Date
      gitRef: string | null
      gitCommitSha: string | null
    }>
    forkedFrom: {
      name: string
      organisation: { slug: string }
    } | null
    starCount: number
    _count: { installationReports: number; forks: number }
  }
  org: string
  name: string
  canManage?: boolean
}

function buildGitViewUrl(
  gitRepoUrl: string | null | undefined,
  gitPath: string | null | undefined,
  ref?: string | null
): string | null {
  if (!gitRepoUrl) return null
  if (gitPath) return `${gitRepoUrl}/tree/${ref ?? 'HEAD'}/${gitPath}`
  return gitRepoUrl
}

export function SkillHeader({ pkg, org, name, canManage }: SkillHeaderProps) {
  const router = useRouter()
  const { data: userOrgs } = trpc.organisations.list.useQuery()
  const forkMutation = trpc.skills.fork.useMutation()
  const deleteMutation = trpc.skills.delete.useMutation()

  const [forkDialogOpen, setForkDialogOpen] = useState(false)
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [copiedInstall, setCopiedInstall] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')

  const latestVersion = pkg.versions[0]?.version ?? '0.0.0'
  const gitViewUrl = buildGitViewUrl(pkg.gitRepoUrl, pkg.gitPath, pkg.gitDefaultRef)

  const installIdentifier =
    pkg.gitUri && pkg.gitPath
      ? `${pkg.gitUri}/${pkg.gitPath}@${pkg.gitDefaultRef}`
      : pkg.gitUri
        ? `${pkg.gitUri}@${pkg.gitDefaultRef}`
        : `${org}/${name}`

  const installCommand = `agentver install ${installIdentifier}`

  const handleCopyInstall = async () => {
    await navigator.clipboard.writeText(installCommand)
    setCopiedInstall(true)
    setTimeout(() => setCopiedInstall(false), 2000)
  }

  const handleForkClick = () => {
    if (userOrgs && userOrgs.length > 0) {
      setSelectedOrgId(userOrgs[0]!.id)
    }
    setForkDialogOpen(true)
  }

  const handleForkConfirm = () => {
    if (!selectedOrgId) return

    const targetOrg = userOrgs?.find((o) => o.id === selectedOrgId)
    forkMutation.mutate(
      { packageId: pkg.id, organisationId: selectedOrgId },
      {
        onSuccess: (forkedPkg) => {
          setForkDialogOpen(false)
          router.push(`/skills/${targetOrg?.slug ?? org}/${forkedPkg.name}`)
        },
      }
    )
  }

  const expectedDeleteConfirmation = `${org}/${pkg.name}`

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
    <>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h2 className="font-display font-semibold text-2xl">
              <span className="text-muted-foreground">@{org}/</span>
              {pkg.name}
            </h2>
            <Badge
              className={cn(
                'border-transparent',
                PACKAGE_TYPE_DISPLAY[pkg.type]?.colour ?? 'bg-secondary text-secondary-foreground'
              )}
            >
              {PACKAGE_TYPE_DISPLAY[pkg.type]?.label ?? pkg.type.toLowerCase()}
            </Badge>
          </div>

          {pkg.description && (
            <p className="mt-1 max-w-2xl text-muted-foreground">{pkg.description}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-4 text-muted-foreground text-sm">
            <span className="flex items-center gap-1 font-mono">v{latestVersion}</span>
            <span className="flex items-center gap-1">
              <Star className="size-3.5" />
              {pkg.starCount} star{pkg.starCount !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1">
              <Monitor className="size-3.5" />
              {pkg._count.installationReports} install
              {pkg._count.installationReports !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1">
              <GitFork className="size-3.5" />
              {pkg._count.forks} fork{pkg._count.forks !== 1 ? 's' : ''}
            </span>
          </div>

          {pkg.compatibilityAgents.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {pkg.compatibilityAgents.map((agent) => {
                const display: AgentDisplayInfo | undefined = AGENT_DISPLAY[agent]
                return (
                  <span
                    key={agent}
                    className={cn(
                      'rounded-full px-2.5 py-0.5 font-medium text-xs',
                      display?.colour ?? 'bg-gray-100 text-gray-700'
                    )}
                  >
                    {display?.label ?? agent}
                  </span>
                )
              })}
            </div>
          )}

          {pkg.gitUri && (
            <div className="mt-2 flex items-center gap-2 text-muted-foreground text-sm">
              <GitBranch className="size-3.5 shrink-0" />
              <span className="font-mono text-xs">{pkg.gitUri}</span>
              {pkg.gitPath && <span className="font-mono text-xs">/{pkg.gitPath}</span>}
              <Badge variant="outline" className="ml-1 font-mono text-xs">
                {pkg.gitDefaultRef}
              </Badge>
              {gitViewUrl && (
                <a
                  href={gitViewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary text-xs hover:underline"
                >
                  <ExternalLink className="size-3" />
                  View source
                </a>
              )}
            </div>
          )}

          {pkg.forkedFrom && (
            <p className="mt-1 text-sm">
              <Link
                href={`/skills/${pkg.forkedFrom.organisation.slug}/${pkg.forkedFrom.name}`}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <GitFork className="h-3 w-3" />
                Forked from {pkg.forkedFrom.organisation.slug}/{pkg.forkedFrom.name}
              </Link>
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <StarButton packageId={pkg.id} />
          <Button variant="outline" size="sm" onClick={() => setInstallDialogOpen(true)}>
            <Terminal className="mr-1 size-3.5" /> Install
          </Button>
          <Button variant="outline" size="sm" onClick={handleForkClick}>
            <GitFork className="mr-1 size-3.5" /> Fork
          </Button>
          {canManage && (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/skills/${org}/${name}/edit`}>
                  <Pencil className="mr-1 size-3.5" /> Edit
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="size-8">
                    <MoreVertical className="size-4" />
                    <span className="sr-only">More actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link
                      href={`/skills/${org}/${name}/settings`}
                      className="flex items-center gap-2"
                    >
                      <Settings className="size-3.5" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="mr-2 size-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* Install Dialog */}
      <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install {pkg.name}</DialogTitle>
            <DialogDescription>
              Run the following command to install this skill via the Agentver CLI.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3 font-mono text-sm">
              <code className="flex-1 break-all">{installCommand}</code>
              <Button variant="ghost" size="icon" className="shrink-0" onClick={handleCopyInstall}>
                {copiedInstall ? (
                  <Check className="size-4 text-emerald-500" />
                ) : (
                  <ClipboardCopy className="size-4" />
                )}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstallDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fork Dialog */}
      <Dialog open={forkDialogOpen} onOpenChange={setForkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fork Package</DialogTitle>
            <DialogDescription>
              Choose which organisation to fork {org}/{name} into.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Organisation</Label>
            {!userOrgs || userOrgs.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                You are not a member of any organisations.
              </p>
            ) : (
              <div className="space-y-2">
                {userOrgs.map((o) => (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-muted"
                  >
                    <input
                      type="radio"
                      name="fork-org"
                      value={o.id}
                      checked={selectedOrgId === o.id}
                      onChange={() => setSelectedOrgId(o.id)}
                      className="accent-primary"
                    />
                    <div>
                      <p className="font-medium text-sm">{o.name}</p>
                      <p className="text-muted-foreground text-xs">{o.slug}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForkDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleForkConfirm} disabled={!selectedOrgId || forkMutation.isPending}>
              {forkMutation.isPending ? 'Forking...' : 'Fork'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      {canManage && (
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
              <Label htmlFor="delete-confirmation">
                Type <strong>{expectedDeleteConfirmation}</strong> to confirm
              </Label>
              <Input
                id="delete-confirmation"
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
      )}
    </>
  )
}
