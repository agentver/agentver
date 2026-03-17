'use client'

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
import { ExternalLink, Pencil, Shield, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { use, useState } from 'react'
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

  const deleteMutation = trpc.skills.delete.useMutation()

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')

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

  const handleVisibilityChange = (visibility: Visibility) => {
    updateMutation.mutate({ id: pkg.id, visibility })
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
