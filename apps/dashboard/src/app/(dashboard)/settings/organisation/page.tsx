'use client'

import { Badge } from '@agentver/ui/components/badge'
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
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import { Skeleton } from '@agentver/ui/components/skeleton'
import { Building2, Loader2, Package, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { CreateOrganisationDialog } from '@/components/settings/create-organisation-dialog'
import { OrgMembersCard } from '@/components/settings/org-members-card'
import { SkillsRepoCard } from '@/components/settings/skills-repo-card'
import { useOrgContext } from '@/hooks/use-org-context'
import { trpc } from '@/trpc/client'

export default function OrganisationSettingsPage() {
  const router = useRouter()
  const { selectedOrg, isLoading: orgLoading } = useOrgContext()

  const orgDetail = trpc.organisations.getBySlug.useQuery(
    { slug: selectedOrg?.slug ?? '' },
    { enabled: !!selectedOrg }
  )

  const utils = trpc.useUtils()

  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const updateOrg = trpc.organisations.update.useMutation({
    onSuccess: () => {
      toast.success('Organisation updated')
      setEditOpen(false)
      orgDetail.refetch()
      utils.organisations.list.invalidate()
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteOrg = trpc.organisations.delete.useMutation({
    onSuccess: () => {
      toast.success('Organisation deleted')
      setDeleteOpen(false)
      utils.organisations.list.invalidate()
      router.push('/settings/organisation')
    },
    onError: (error) => toast.error(error.message),
  })

  const [createOpen, setCreateOpen] = useState(false)

  if (orgLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="font-bold text-2xl tracking-tight">Organisation</h2>
          <p className="text-muted-foreground">
            Manage your organisation settings, members, and package repository.
          </p>
        </div>
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-64" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!selectedOrg) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="font-bold text-2xl tracking-tight">Organisation</h2>
          <p className="text-muted-foreground">
            Manage your organisation settings, members, and package repository.
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <Building2 className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mt-4 font-semibold text-lg">No organisations yet</h3>
            <p className="mt-1 max-w-sm text-muted-foreground text-sm">
              Create an organisation to start publishing and managing agent skills with your team.
            </p>
            <Button className="mt-6" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Organisation
            </Button>
          </CardContent>
        </Card>
        <CreateOrganisationDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    )
  }

  const org = orgDetail.data
  const currentUserRole = org?.currentUserRole ?? 'MEMBER'
  const currentUserId = org?.currentUserId ?? ''
  const canEdit = currentUserRole === 'OWNER' || currentUserRole === 'ADMIN'
  const canDelete = currentUserRole === 'OWNER'

  function handleEditOpen() {
    setEditName(selectedOrg?.name ?? '')
    setEditOpen(true)
  }

  const refetchAll = () => {
    orgDetail.refetch()
    utils.organisations.list.invalidate()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-bold text-2xl tracking-tight">Organisation</h2>
        <p className="text-muted-foreground">
          Manage your organisation settings, members, and package repository.
        </p>
      </div>

      {/* Section A: Organisation Details */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {selectedOrg.image ? (
                <img src={selectedOrg.image} alt="" className="h-10 w-10 rounded-lg" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div>
                <CardTitle>{selectedOrg.name}</CardTitle>
                <CardDescription className="font-mono text-xs">{selectedOrg.slug}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && (
                <Button variant="outline" size="sm" onClick={handleEditOpen}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setDeleteConfirm('')
                    setDeleteOpen(true)
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Badge variant="secondary" className="gap-1">
              <Users className="h-3 w-3" />
              {selectedOrg._count.members} member{selectedOrg._count.members !== 1 ? 's' : ''}
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <Package className="h-3 w-3" />
              {selectedOrg._count.packages} package{selectedOrg._count.packages !== 1 ? 's' : ''}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Section B: Members */}
      {org && (
        <OrgMembersCard
          organisationId={org.id}
          members={org.members.map((m) => ({
            userId: m.userId,
            role: m.role,
            user: m.user,
          }))}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          onRefetch={refetchAll}
        />
      )}

      {/* Section C: Skills Repository */}
      <SkillsRepoCard
        organisationId={selectedOrg.id}
        skillsRepoUrl={selectedOrg.skillsRepoUrl}
        skillsRepoOwner={selectedOrg.skillsRepoOwner}
        skillsRepoName={selectedOrg.skillsRepoName}
        skillsRepoProvider={selectedOrg.skillsRepoProvider}
        canManage={canEdit}
        onRefetch={refetchAll}
      />

      {/* Edit Name Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Organisation</DialogTitle>
            <DialogDescription>Update your organisation&apos;s name.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-org-name">Name</Label>
              <Input
                id="edit-org-name"
                value={editName}
                onChange={(e) => setEditName(e.currentTarget.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                updateOrg.mutate({
                  organisationId: selectedOrg.id,
                  name: editName,
                })
              }
              disabled={!editName || editName === selectedOrg.name || updateOrg.isPending}
            >
              {updateOrg.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {updateOrg.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Organisation</DialogTitle>
            <DialogDescription>
              This action is irreversible. All teams, packages, API keys, and member associations
              will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm">
              Type <strong>{selectedOrg.slug}</strong> to confirm deletion:
            </p>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.currentTarget.value)}
              placeholder={selectedOrg.slug}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteOrg.mutate({ organisationId: selectedOrg.id })}
              disabled={deleteConfirm !== selectedOrg.slug || deleteOrg.isPending}
            >
              {deleteOrg.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {deleteOrg.isPending ? 'Deleting...' : 'Delete Organisation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
