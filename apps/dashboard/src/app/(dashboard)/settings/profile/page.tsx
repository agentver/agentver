'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@agentver/ui/components/avatar'
import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@agentver/ui/components/card'
import { Skeleton } from '@agentver/ui/components/skeleton'
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ExternalLink,
  Package,
  Users,
  XCircle,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useSession } from '@/lib/auth/client'
import { trpc } from '@/trpc/client'

const PROVIDER_META: Record<string, { name: string; logo: string; darkInvert?: boolean }> = {
  GITHUB: { name: 'GitHub', logo: '/images/integrations/github.svg', darkInvert: true },
  GITLAB: { name: 'GitLab', logo: '/images/integrations/gitlab.svg' },
  BITBUCKET: { name: 'Bitbucket', logo: '/images/integrations/bitbucket.svg' },
  GOOGLE: { name: 'Google Drive', logo: '/images/integrations/google-drive.png' },
  MICROSOFT: { name: 'OneDrive', logo: '/images/integrations/microsoft-onedrive.png' },
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export default function ProfilePage() {
  const { data: session } = useSession()
  const user = session?.user
  const orgs = trpc.organisations.list.useQuery()
  const connections = trpc.connections.list.useQuery()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-bold text-2xl tracking-tight">Profile</h2>
        <p className="text-muted-foreground">Your account information and memberships.</p>
      </div>

      {/* Account Card */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your profile details.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={user?.image ?? undefined} />
              <AvatarFallback>{getInitials(user?.name)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-lg">{user?.name}</p>
              <p className="text-muted-foreground text-sm">{user?.email}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connected Accounts Summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Connected Accounts</CardTitle>
              <CardDescription>
                External accounts linked for browsing and importing packages.
              </CardDescription>
            </div>
            <Link href="/settings/connections">
              <Button variant="ghost" size="sm">
                Manage
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {connections.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(PROVIDER_META).map(([key, meta]) => {
                const account = connections.data?.find((c) => c.provider === key)
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                        <Image
                          src={meta.logo}
                          alt={meta.name}
                          width={18}
                          height={18}
                          className={meta.darkInvert ? 'dark:invert' : undefined}
                        />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{meta.name}</p>
                        {account && (
                          <p className="text-muted-foreground text-xs">
                            {account.providerAccountName ?? account.providerAccountId}
                          </p>
                        )}
                      </div>
                    </div>
                    {account ? (
                      <Badge
                        variant="outline"
                        className="border-green-500 text-green-600 dark:text-green-400"
                      >
                        <CheckCircle2 className="mr-1 size-3" />
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        <XCircle className="mr-1 size-3" />
                        Not connected
                      </Badge>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Organisations Card */}
      <Card>
        <CardHeader>
          <CardTitle>Organisations</CardTitle>
          <CardDescription>Organisations you are a member of.</CardDescription>
        </CardHeader>
        <CardContent>
          {orgs.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : orgs.data && orgs.data.length > 0 ? (
            <div className="space-y-2">
              {orgs.data.map((org) => (
                <div
                  key={org.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="flex items-center gap-3">
                    {org.image ? (
                      <img src={org.image} alt="" className="h-10 w-10 rounded-lg" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                        <Building2 className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div>
                      <p className="font-medium">{org.name}</p>
                      <p className="font-mono text-muted-foreground text-xs">{org.slug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="hidden items-center gap-3 sm:flex">
                      <Badge variant="secondary" className="gap-1">
                        <Users className="h-3 w-3" />
                        {org._count.members}
                      </Badge>
                      <Badge variant="secondary" className="gap-1">
                        <Package className="h-3 w-3" />
                        {org._count.packages}
                      </Badge>
                    </div>
                    <Link href={`/settings/organisation?org=${org.slug}`}>
                      <Button variant="ghost" size="sm">
                        Manage
                        <ExternalLink className="ml-1 h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              You are not a member of any organisations yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
