'use client'

import { Package } from 'lucide-react'
import Link from 'next/link'
import { Suspense, use, useMemo, useState } from 'react'
import { FadeIn } from '@/components/fade-in'
import { SkillGrid } from '@/components/skills/skill-grid'
import { SkillList } from '@/components/skills/skill-list'
import { trpc } from '@/trpc/client'

type OrgPackagesPageProps = {
  params: Promise<{ org: string }>
}

export default function OrgPackagesPage({ params }: OrgPackagesPageProps) {
  const { org } = use(params)

  return (
    <Suspense
      fallback={
        <div className="space-y-8">
          <div>
            <div className="h-9 w-48 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-5 w-64 animate-pulse rounded bg-muted" />
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        </div>
      }
    >
      <OrgPackagesContent org={org} />
    </Suspense>
  )
}

function OrgPackagesContent({ org }: { org: string }) {
  const [view, setView] = useState<'grid' | 'list'>('grid')

  const { data, isLoading } = trpc.skills.list.useQuery({})

  const packages = useMemo(() => {
    if (!data?.packages) return []
    return data.packages.filter((pkg) => pkg.organisation.slug === org)
  }, [data?.packages, org])

  const isEmpty = !isLoading && packages.length === 0

  return (
    <div className="space-y-8">
      <FadeIn>
        <h1 className="page-title">@{org} Packages</h1>
        <p className="page-description">
          All packages belonging to the <span className="font-medium">@{org}</span> organisation.
        </p>
      </FadeIn>

      <FadeIn delay={80}>
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            {isLoading
              ? 'Loading...'
              : `${packages.length} ${packages.length === 1 ? 'package' : 'packages'}`}
          </p>
          <div className="flex rounded-lg border">
            <button
              type="button"
              onClick={() => setView('grid')}
              className={`rounded-l-lg px-3 py-1.5 text-sm ${view === 'grid' ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Grid
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={`rounded-r-lg px-3 py-1.5 text-sm ${view === 'list' ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              List
            </button>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={160}>
        {isLoading ? (
          view === 'grid' ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          )
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Package className="size-7" />
            </div>
            <h2 className="mt-6 font-display font-semibold text-xl tracking-tight">
              No packages found
            </h2>
            <p className="mt-2 max-w-md text-muted-foreground">
              The organisation <span className="font-medium">@{org}</span> has no packages, or you
              do not have access to view them.
            </p>
            <Link href="/skills" className="mt-4 text-primary text-sm hover:underline">
              Browse all packages
            </Link>
          </div>
        ) : view === 'grid' ? (
          <SkillGrid packages={packages} />
        ) : (
          <SkillList packages={packages} />
        )}
      </FadeIn>
    </div>
  )
}
