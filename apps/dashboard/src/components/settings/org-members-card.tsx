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
  DialogTrigger,
} from '@agentver/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@agentver/ui/components/dropdown-menu'
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agentver/ui/components/select'
import { ChevronDown, Crown, Shield, UserMinus, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/trpc/client'

type OrgMember = {
  userId: string
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
  user: {
    id: string
    name: string | null
    email: string
    image: string | null
  }
}

type OrgMembersCardProps = {
  organisationId: string
  members: OrgMember[]
  currentUserId: string
  currentUserRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
  onRefetch: () => void
}

const ROLE_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  OWNER: 'default',
  ADMIN: 'secondary',
  MEMBER: 'outline',
  VIEWER: 'outline',
}

const ROLE_ICON: Record<string, typeof Crown | typeof Shield | typeof Users> = {
  OWNER: Crown,
  ADMIN: Shield,
}

const ASSIGNABLE_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const

export function OrgMembersCard({
  organisationId,
  members,
  currentUserId,
  currentUserRole,
  onRefetch,
}: OrgMembersCardProps) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER' | 'VIEWER'>('MEMBER')

  const canManageMembers = currentUserRole === 'OWNER' || currentUserRole === 'ADMIN'

  const invite = trpc.organisations.invite.useMutation({
    onSuccess: () => {
      toast.success('Member invited')
      setInviteEmail('')
      setInviteRole('MEMBER')
      setInviteOpen(false)
      onRefetch()
    },
    onError: (error) => toast.error(error.message),
  })

  const updateRole = trpc.organisations.updateMemberRole.useMutation({
    onSuccess: () => {
      toast.success('Role updated')
      onRefetch()
    },
    onError: (error) => toast.error(error.message),
  })

  const removeMember = trpc.organisations.removeMember.useMutation({
    onSuccess: () => {
      toast.success('Member removed')
      onRefetch()
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Members
            </CardTitle>
            <CardDescription>
              {members.length} member{members.length !== 1 ? 's' : ''} in this organisation
            </CardDescription>
          </div>
          {canManageMembers && (
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <UserPlus className="mr-2 h-4 w-4" />
                  Invite
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite Member</DialogTitle>
                  <DialogDescription>
                    Invite a user by their email address. They must already have an account.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input
                      id="invite-email"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.currentTarget.value)}
                      placeholder="colleague@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-role">Role</Label>
                    <Select
                      value={inviteRole}
                      onValueChange={(v) => setInviteRole(v as 'ADMIN' | 'MEMBER' | 'VIEWER')}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ADMIN">Admin</SelectItem>
                        <SelectItem value="MEMBER">Member</SelectItem>
                        <SelectItem value="VIEWER">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() =>
                      invite.mutate({
                        organisationId,
                        email: inviteEmail,
                        role: inviteRole,
                      })
                    }
                    disabled={!inviteEmail || invite.isPending}
                  >
                    {invite.isPending ? 'Inviting...' : 'Invite'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {members.map((member) => {
            const RoleIcon = ROLE_ICON[member.role]
            const isSelf = member.userId === currentUserId

            return (
              <div
                key={member.userId}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="flex items-center gap-3">
                  {member.user.image ? (
                    <img src={member.user.image} alt="" className="h-8 w-8 rounded-full" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted font-medium text-xs">
                      {(member.user.name ?? member.user.email).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-sm">
                      {member.user.name ?? member.user.email}
                      {isSelf && <span className="ml-1 text-muted-foreground text-xs">(you)</span>}
                    </p>
                    <p className="text-muted-foreground text-xs">{member.user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canManageMembers && !isSelf ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1">
                          <Badge variant={ROLE_BADGE_VARIANT[member.role] ?? 'outline'}>
                            {RoleIcon && <RoleIcon className="mr-1 h-3 w-3" />}
                            {member.role}
                          </Badge>
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {ASSIGNABLE_ROLES.map((role) => (
                          <DropdownMenuItem
                            key={role}
                            disabled={role === member.role || updateRole.isPending}
                            onClick={() =>
                              updateRole.mutate({
                                organisationId,
                                userId: member.userId,
                                role,
                              })
                            }
                          >
                            {role}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <Badge variant={ROLE_BADGE_VARIANT[member.role] ?? 'outline'}>
                      {RoleIcon && <RoleIcon className="mr-1 h-3 w-3" />}
                      {member.role}
                    </Badge>
                  )}
                  {canManageMembers && !isSelf && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        removeMember.mutate({
                          organisationId,
                          userId: member.userId,
                        })
                      }
                      disabled={removeMember.isPending}
                    >
                      <UserMinus className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
