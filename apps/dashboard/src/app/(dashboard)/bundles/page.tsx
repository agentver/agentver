'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@agentver/ui/components/card'
import { Globe, Layers, Lock, Package, Plus } from 'lucide-react'
import Link from 'next/link'
import { trpc } from '@/trpc/client'

export default function BundlesPage() {
  const { data, isLoading } = trpc.bundles.list.useQuery({})

  const bundles = data?.bundles ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-display font-semibold text-2xl tracking-tight">Bundles</h2>
          <p className="text-muted-foreground">
            Curated collections of packages, MCP servers, and credentials for one-command setup.
          </p>
        </div>

        <Button asChild>
          <Link href="/bundles/new">
            <Plus className="h-4 w-4" />
            Create Bundle
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : bundles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-light text-primary">
            <Layers className="size-5" />
          </div>
          <p className="mt-4 font-display font-medium text-lg">No bundles yet</p>
          <p className="mt-1 max-w-sm text-center text-muted-foreground text-sm">
            Bundles group packages, MCP servers, and credentials together for streamlined
            installation.
          </p>
          <Button asChild className="mt-4">
            <Link href="/bundles/new">
              <Plus className="h-4 w-4" />
              Create your first bundle
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {bundles.map((bundle) => {
            const latestVersion = bundle.versions[0]

            return (
              <Link key={bundle.id} href={`/bundles/${bundle.organisation.slug}/${bundle.name}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base">{bundle.name}</CardTitle>
                      <Badge
                        variant={bundle.visibility === 'PUBLIC' ? 'secondary' : 'outline'}
                        className="text-xs"
                      >
                        {bundle.visibility === 'PUBLIC' ? (
                          <Globe className="mr-1 h-3 w-3" />
                        ) : (
                          <Lock className="mr-1 h-3 w-3" />
                        )}
                        {bundle.visibility.toLowerCase()}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-sm">{bundle.organisation.slug}</p>
                  </CardHeader>
                  <CardContent>
                    {bundle.description && (
                      <p className="mb-3 line-clamp-2 text-muted-foreground text-sm">
                        {bundle.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-muted-foreground text-xs">
                      {latestVersion && <span className="font-mono">v{latestVersion.version}</span>}
                      <span className="flex items-center gap-1">
                        <Package className="h-3 w-3" /> {bundle._count.installationReports}{' '}
                        {bundle._count.installationReports === 1 ? 'install' : 'installs'}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
