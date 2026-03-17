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
  DialogTrigger,
} from '@agentver/ui/components/dialog'
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import { Package, Plus, Trash2, UserMinus, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/trpc/client'

type ExpandedTeam = {
  id: string
  slug: string
  organisationId: string
}

export default function TeamsSettingsPage() {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [expandedTeam, setExpandedTeam] = useState<ExpandedTeam | null>(null)

  const orgs = trpc.organisations.list.useQuery()
  const orgId = orgs.data?.[0]?.id
  const currentOrg = orgs.data?.[0]

  const teams = trpc.teams.list.useQuery({ organisationId: orgId! }, { enabled: !!orgId })

  const teamDetail = trpc.teams.getBySlug.useQuery(
    {
      organisationId: expandedTeam?.organisationId ?? '',
      slug: expandedTeam?.slug ?? '',
    },
    { enabled: !!expandedTeam }
  )

  const orgDetail = trpc.organisations.getBySlug.useQuery(
    { slug: currentOrg?.slug ?? '' },
    { enabled: !!currentOrg && !!expandedTeam }
  )

  const createTeam = trpc.teams.create.useMutation({
    onSuccess: () => {
      toast.success('Team created')
      teams.refetch()
      setName('')
      setSlug('')
      setCreateOpen(false)
    },
    onError: (error) => toast.error(error.message),
  })

  const addMember = trpc.teams.addMember.useMutation({
    onSuccess: () => {
      toast.success('Member added to team')
      teamDetail.refetch()
      teams.refetch()
    },
    onError: (error) => toast.error(error.message),
  })

  const removeMember = trpc.teams.removeMember.useMutation({
    onSuccess: () => {
      toast.success('Member removed from team')
      teamDetail.refetch()
      teams.refetch()
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteTeam = trpc.teams.delete.useMutation({
    onSuccess: () => {
      toast.success('Team deleted')
      setExpandedTeam(null)
      teams.refetch()
    },
    onError: (error) => toast.error(error.message),
  })

  const teamMemberIds = new Set(teamDetail.data?.members.map((m) => m.userId) ?? [])
  const availableOrgMembers = orgDetail.data?.members.filter((m) => !teamMemberIds.has(m.userId))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-2xl tracking-tight">Teams</h2>
          <p className="text-muted-foreground">Manage teams within your organisation.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Team
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Team</DialogTitle>
              <DialogDescription>
                Create a new team to organise members and packages.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="team-name">Name</Label>
                <Input
                  id="team-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.currentTarget.value)
                    setSlug(e.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
                  }}
                  placeholder="Engineering"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-slug">Slug</Label>
                <Input
                  id="team-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.currentTarget.value)}
                  placeholder="engineering"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => orgId && createTeam.mutate({ organisationId: orgId, name, slug })}
                disabled={!name || !slug || !orgId || createTeam.isPending}
              >
                {createTeam.isPending ? 'Creating...' : 'Create Team'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {teams.data && teams.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.data.map((team) => (
            <Card
              key={team.id}
              className={`cursor-pointer transition-shadow hover:shadow-md ${
                expandedTeam?.id === team.id ? 'ring-2 ring-primary' : ''
              }`}
              onClick={() =>
                setExpandedTeam(
                  expandedTeam?.id === team.id
                    ? null
                    : { id: team.id, slug: team.slug, organisationId: team.organisationId }
                )
              }
            >
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4" />
                  {team.name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 text-muted-foreground text-sm">
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {team._count.members} member(s)
                  </span>
                  <span className="flex items-center gap-1">
                    <Package className="h-3.5 w-3.5" />
                    {team._count.packages} package(s)
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {teams.data && teams.data.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="font-medium text-lg">No teams yet</p>
            <p className="text-muted-foreground text-sm">
              Create a team to organise members and control package visibility.
            </p>
          </CardContent>
        </Card>
      )}

      {expandedTeam && teamDetail.data && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{teamDetail.data.name ?? expandedTeam.slug}</CardTitle>
                <CardDescription>
                  {teamDetail.data._count.packages} package(s) &middot;{' '}
                  {teamDetail.data.members.length} member(s)
                </CardDescription>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteTeam.mutate({ teamId: expandedTeam.id })}
                disabled={deleteTeam.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {deleteTeam.isPending ? 'Deleting...' : 'Delete Team'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="mb-2 font-medium text-sm">Members</h4>
              <div className="space-y-2">
                {teamDetail.data.members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <p className="font-medium text-sm">{member.user.name ?? member.user.email}</p>
                      <p className="text-muted-foreground text-xs">{member.user.email}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        removeMember.mutate({
                          teamId: expandedTeam.id,
                          userId: member.userId,
                        })
                      }
                    >
                      <UserMinus className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {availableOrgMembers && availableOrgMembers.length > 0 && (
              <div>
                <h4 className="mb-2 font-medium text-sm">Add Organisation Members</h4>
                <div className="space-y-2">
                  {availableOrgMembers.map((member) => (
                    <div
                      key={member.userId}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div>
                        <p className="font-medium text-sm">
                          {member.user.name ?? member.user.email}
                        </p>
                        <p className="text-muted-foreground text-xs">{member.user.email}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          addMember.mutate({
                            teamId: expandedTeam.id,
                            userId: member.userId,
                          })
                        }
                      >
                        <UserPlus className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
