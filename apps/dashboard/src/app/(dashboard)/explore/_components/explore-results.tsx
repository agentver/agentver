'use client'

import { Button } from '@agentver/ui/components/button'
import { Package, Search } from 'lucide-react'
import { trpc } from '@/trpc/client'
import { ExploreCard } from './explore-card'
import type { SortOption } from './sort-select'

type ExploreResultsProps = {
  query: string
  category: string | null
  sort: SortOption
}

export function ExploreResults({ query, category, sort }: ExploreResultsProps) {
  // When there's a search query, use the full-text search endpoint
  const searchEnabled = query.length > 0
  const browseEnabled = !searchEnabled

  const searchResult = trpc.search.search.useQuery(
    {
      query,
      category: category ?? undefined,
      sort:
        sort === 'trending'
          ? 'relevance'
          : sort === 'stars'
            ? 'stars'
            : sort === 'installs'
              ? 'installs'
              : 'recent',
      limit: 24,
    },
    { enabled: searchEnabled }
  )

  const browseResult = trpc.explore.browse.useInfiniteQuery(
    {
      category: category ?? undefined,
      sort,
      limit: 24,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: browseEnabled,
    }
  )

  const isLoading = searchEnabled ? searchResult.isLoading : browseResult.isLoading

  if (isLoading) {
    return (
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    )
  }

  // Normalise results from both endpoints
  const allPackages = searchEnabled
    ? (searchResult.data?.results ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        orgSlug: r.organisation.slug,
        description: r.description,
        type: r.type,
        starCount: r.starCount,
        installCount: r.installCount,
        compatibilityAgents: r.compatibilityAgents,
        updatedAt: r.updatedAt,
        categories: r.categories.map((c) => ({ category: { name: c.name, slug: c.slug } })),
      }))
    : (browseResult.data?.pages.flatMap((page) => page.packages) ?? []).map((pkg) => ({
        id: pkg.id,
        name: pkg.name,
        orgSlug: pkg.organisation.slug,
        description: pkg.description,
        type: pkg.type,
        starCount: pkg.starCount,
        installCount: pkg.installCount,
        compatibilityAgents: pkg.compatibilityAgents,
        updatedAt: pkg.updatedAt,
        categories: pkg.categories,
        isVerified: pkg.isVerified,
      }))

  if (allPackages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-light text-primary">
          {query ? <Search className="size-5" /> : <Package className="size-5" />}
        </div>
        <p className="mt-4 font-display font-semibold text-lg">
          {query ? 'No results found' : 'Registry Skills'}
        </p>
        <p className="mt-1 max-w-sm text-muted-foreground text-sm">
          {query
            ? `No skills matching "${query}". Try a different search term.`
            : 'Registry skills will appear here. Check out MCP Servers and Community Skills below!'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {allPackages.map((pkg) => (
          <ExploreCard
            key={pkg.id}
            name={pkg.name}
            orgSlug={pkg.orgSlug}
            description={pkg.description}
            type={pkg.type}
            starCount={pkg.starCount}
            installCount={pkg.installCount}
            compatibilityAgents={pkg.compatibilityAgents}
            updatedAt={pkg.updatedAt}
            categories={pkg.categories}
            isVerified={'isVerified' in pkg ? (pkg.isVerified as boolean) : undefined}
          />
        ))}
      </div>

      {browseEnabled && browseResult.hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            onClick={() => browseResult.fetchNextPage()}
            disabled={browseResult.isFetchingNextPage}
          >
            {browseResult.isFetchingNextPage ? 'Loading...' : 'Load More'}
          </Button>
        </div>
      )}
    </div>
  )
}
