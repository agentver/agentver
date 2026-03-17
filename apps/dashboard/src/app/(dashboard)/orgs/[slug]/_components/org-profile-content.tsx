'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@agentver/ui/components/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@agentver/ui/components/tabs'
import { Building2, Download, Package, Star, Users } from 'lucide-react'
import Link from 'next/link'
import { ExploreCard } from '@/app/(dashboard)/explore/_components/explore-card'
import { formatCount } from '@/components/install-badge'
import { VerifiedBadge } from '@/components/verified-badge'
import { trpc } from '@/trpc/client'

type OrgProfileContentProps = {
  slug: string
}

export function OrgProfileContent({ slug }: OrgProfileContentProps) {
  const { data, isLoading } = trpc.explore.orgProfile.useQuery({ slug })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="size-16 animate-pulse rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-7 w-48 animate-pulse rounded bg-muted" />
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Building2 className="size-12 text-muted-foreground" />
        <p className="mt-4 font-display font-medium text-lg">Organisation not found</p>
        <p className="mt-1 text-muted-foreground text-sm">
          The organisation &quot;{slug}&quot; does not exist or is not publicly visible.
        </p>
      </div>
    )
  }

  const initials = data.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start gap-5">
        <Avatar className="size-16">
          {data.image && <AvatarImage src={data.image} alt={data.name} />}
          <AvatarFallback className="text-lg">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-display font-semibold text-2xl tracking-tight">
            {data.name}
            {'isVerified' in data && data.isVerified && <VerifiedBadge size="md" />}
          </h2>
          <p className="text-muted-foreground text-sm">@{data.slug}</p>
          <div className="mt-3 flex flex-wrap gap-4 text-muted-foreground text-sm">
            <span className="flex items-center gap-1.5">
              <Users className="size-4" /> {data._count.members}{' '}
              {data._count.members === 1 ? 'member' : 'members'}
            </span>
            <span className="flex items-center gap-1.5">
              <Package className="size-4" /> {data._count.packages}{' '}
              {data._count.packages === 1 ? 'package' : 'packages'}
            </span>
            <span className="flex items-center gap-1.5">
              <Star className="size-4" /> {formatCount(data.totalStars)} stars
            </span>
            <span className="flex items-center gap-1.5">
              <Download className="size-4" /> {formatCount(data.totalInstalls)} installs
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="skills">
        <TabsList>
          <TabsTrigger value="skills">Skills ({data.packages.length})</TabsTrigger>
          <TabsTrigger value="members">Members ({data.members.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="skills">
          {data.packages.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-16 text-center">
              <Package className="size-8 text-muted-foreground" />
              <p className="mt-3 font-medium">No public packages</p>
              <p className="mt-1 text-muted-foreground text-sm">
                This organisation has not published any public packages yet.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.packages.map((pkg) => (
                <ExploreCard
                  key={pkg.id}
                  name={pkg.name}
                  orgSlug={pkg.organisation.slug}
                  description={pkg.description}
                  type={pkg.type}
                  starCount={pkg.starCount}
                  installCount={pkg.installCount}
                  compatibilityAgents={pkg.compatibilityAgents}
                  updatedAt={pkg.updatedAt}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="members">
          <div className="space-y-2 pt-4">
            {data.members.map((member) => {
              const memberInitials = (member.user.name ?? member.user.username ?? '?')
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()

              return (
                <div
                  key={member.user.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                >
                  <Avatar className="size-9">
                    {member.user.image && (
                      <AvatarImage src={member.user.image} alt={member.user.name ?? ''} />
                    )}
                    <AvatarFallback className="text-xs">{memberInitials}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    {member.user.username ? (
                      <Link
                        href={`/users/${member.user.username}`}
                        className="font-medium text-sm hover:underline"
                      >
                        {member.user.name ?? member.user.username}
                      </Link>
                    ) : (
                      <p className="font-medium text-sm">{member.user.name ?? 'Unknown'}</p>
                    )}
                    {member.user.username && (
                      <p className="text-muted-foreground text-xs">@{member.user.username}</p>
                    )}
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs capitalize">
                    {member.role.toLowerCase()}
                  </span>
                </div>
              )
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
