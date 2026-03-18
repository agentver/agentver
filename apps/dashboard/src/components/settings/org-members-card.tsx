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
import { Separator } from '@agentver/ui/components/separator'
import {
  ChevronDown,
  Crown,
  Loader2,
  Mail,
  RefreshCw,
  Shield,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
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

function formatExpiryDate(date: Date): string {
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffMs < 0) return 'Expired'
  if (diffDays === 0) return 'Expires today'
  if (diffDays === 1) return 'Expires tomorrow'
  return `Expires in ${diffDays} days`
}

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

  const invitations = trpc.organisations.listInvitations.useQuery(
    { organisationId },
    { enabled: canManageMembers }
  )

  const sendInvitation = trpc.organisations.sendInvitation.useMutation({
    onSuccess: () => {
      toast.success('Invitation sent')
      setInviteEmail('')
      setInviteRole('MEMBER')
      setInviteOpen(false)
      onRefetch()
      void invitations.refetch()
    },
    onError: (error) => toast.error(error.message),
  })

  const resendInvitation = trpc.organisations.resendInvitation.useMutation({
    onSuccess: () => {
      toast.success('Invitation resent')
      void invitations.refetch()
    },
    onError: (error) => toast.error(error.message),
  })

  const cancelInvitation = trpc.organisations.cancelInvitation.useMutation({
    onSuccess: () => {
      toast.success('Invitation cancelled')
      void invitations.refetch()
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

  const pendingInvitations = invitations.data ?? []

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
                  Send Invitation
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Send Invitation</DialogTitle>
                  <DialogDescription>
                    Send an email invitation. They do not need an account yet.
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
                      sendInvitation.mutate({
                        organisationId,
                        email: inviteEmail,
                        role: inviteRole,
                      })
                    }
                    disabled={!inviteEmail || sendInvitation.isPending}
                  >
                    {sendInvitation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      'Send Invitation'
                    )}
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

        {canManageMembers && pendingInvitations.length > 0 && (
          <>
            <Separator className="my-4" />
            <div className="space-y-3">
              <h4 className="flex items-center gap-2 font-medium text-sm">
                <Mail className="h-4 w-4" />
                Pending Invitations
              </h4>
              <div className="space-y-2">
                {pendingInvitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex items-center justify-between rounded-md border border-dashed p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{invitation.email}</p>
                        <p className="text-muted-foreground text-xs">
                          {formatExpiryDate(new Date(invitation.expiresAt))}
                          {invitation.invitedBy?.name &&
                            ` · Invited by ${invitation.invitedBy.name}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={ROLE_BADGE_VARIANT[invitation.role] ?? 'outline'}>
                        {invitation.role}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => resendInvitation.mutate({ invitationId: invitation.id })}
                        disabled={resendInvitation.isPending}
                        title="Resend invitation"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => cancelInvitation.mutate({ invitationId: invitation.id })}
                        disabled={cancelInvitation.isPending}
                        title="Cancel invitation"
                      >
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
