'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@agentver/ui/components/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@agentver/ui/components/tabs'
import { Building2, Package, Star, User } from 'lucide-react'
import Link from 'next/link'
import { ExploreCard } from '@/app/(dashboard)/explore/_components/explore-card'
import { trpc } from '@/trpc/client'

type UserProfileContentProps = {
  username: string
}

export function UserProfileContent({ username }: UserProfileContentProps) {
  const { data, isLoading } = trpc.explore.userProfile.useQuery({ username })

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
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <User className="size-12 text-muted-foreground" />
        <p className="mt-4 font-display font-medium text-lg">User not found</p>
        <p className="mt-1 text-muted-foreground text-sm">
          The user &quot;{username}&quot; does not exist.
        </p>
      </div>
    )
  }

  const initials = (data.name ?? data.username ?? '?')
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
          {data.image && <AvatarImage src={data.image} alt={data.name ?? data.username ?? ''} />}
          <AvatarFallback className="text-lg">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-semibold text-2xl tracking-tight">
            {data.name ?? data.username}
          </h2>
          {data.username && <p className="text-muted-foreground text-sm">@{data.username}</p>}

          {/* Organisations */}
          {data.memberships.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.memberships.map((membership) => (
                <Link
                  key={membership.organisation.id}
                  href={`/orgs/${membership.organisation.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
                >
                  {membership.organisation.image ? (
                    <Avatar className="size-4">
                      <AvatarImage
                        src={membership.organisation.image}
                        alt={membership.organisation.name}
                      />
                      <AvatarFallback className="text-[8px]">
                        {membership.organisation.name[0]}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <Building2 className="size-3.5 text-muted-foreground" />
                  )}
                  <span>{membership.organisation.name}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="published">
        <TabsList>
          <TabsTrigger value="published">
            <Package className="mr-1.5 size-3.5" />
            Published ({data.publishedPackages.length})
          </TabsTrigger>
          <TabsTrigger value="starred">
            <Star className="mr-1.5 size-3.5" />
            Starred ({data.starredPackages.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="published">
          {data.publishedPackages.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-16 text-center">
              <Package className="size-8 text-muted-foreground" />
              <p className="mt-3 font-medium">No published packages</p>
              <p className="mt-1 text-muted-foreground text-sm">
                This user has not published any public packages yet.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.publishedPackages.map((pkg) => (
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

        <TabsContent value="starred">
          {data.starredPackages.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-16 text-center">
              <Star className="size-8 text-muted-foreground" />
              <p className="mt-3 font-medium">No starred packages</p>
              <p className="mt-1 text-muted-foreground text-sm">
                This user has not starred any packages yet.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.starredPackages.map((pkg) => (
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
      </Tabs>
    </div>
  )
}
