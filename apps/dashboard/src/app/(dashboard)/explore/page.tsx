'use client'

import { Suspense, useState } from 'react'
import { FadeIn } from '@/components/fade-in'
import { trpc } from '@/trpc/client'
import { CategorySidebar } from './_components/category-sidebar'
import { CommunityResults } from './_components/community-results'
import { ExploreResults } from './_components/explore-results'
import { McpCategorySidebar } from './_components/mcp-category-sidebar'
import { McpPreviewSection } from './_components/mcp-preview'
import { McpResults } from './_components/mcp-results'
import { SearchBar } from './_components/search-bar'
import { type SortOption, SortSelect } from './_components/sort-select'
import { type ExploreSource, SourceTabs } from './_components/source-tabs'
import { TrendingSection } from './_components/trending'

export default function ExplorePage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div>
            <h2 className="font-display font-semibold text-3xl tracking-tight">Explore</h2>
            <p className="text-muted-foreground leading-relaxed">
              Discover packages, community skills, and MCP servers from the registry.
            </p>
          </div>
          <div className="h-11 animate-pulse rounded-2xl bg-muted" />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        </div>
      }
    >
      <ExplorePageContent />
    </Suspense>
  )
}

function StatsBar() {
  const { data: mcpCount } = trpc.mcpCatalogue.count.useQuery()

  if (!mcpCount) return null

  return (
    <p className="text-muted-foreground text-sm">
      {mcpCount} MCP servers &middot; 500+ community skills via skills.sh
    </p>
  )
}

function ExplorePageContent() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<SortOption>('trending')
  const [source, setSource] = useState<ExploreSource>('agentver')

  const isAgentver = source === 'agentver'
  const isMcp = source === 'mcp'
  const showTrending = isAgentver && !query && !category
  const hasSidebar = isAgentver || isMcp

  const handleSourceChange = (newSource: ExploreSource) => {
    setSource(newSource)
    setCategory(null)
    setQuery('')
  }

  return (
    <div className="space-y-6">
      <FadeIn>
        <div>
          <h2 className="font-display font-semibold text-2xl tracking-tight">Explore</h2>
          <p className="text-muted-foreground">
            Discover packages, community skills, and MCP servers from the registry.
          </p>
          <div className="mt-2">
            <StatsBar />
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={50}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <SourceTabs value={source} onChange={handleSourceChange} />
        </div>
      </FadeIn>

      <FadeIn delay={100}>
        <SearchBar value={query} onChange={setQuery} />
      </FadeIn>

      {hasSidebar ? (
        <div className="flex gap-8">
          {/* Category sidebar */}
          <FadeIn delay={150}>
            <aside className="hidden w-48 shrink-0 lg:block">
              <h3 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                Categories
              </h3>
              {isAgentver ? (
                <CategorySidebar selected={category} onSelect={setCategory} />
              ) : (
                <McpCategorySidebar selected={category} onSelect={setCategory} />
              )}
            </aside>
          </FadeIn>

          {/* Main content */}
          <div className="min-w-0 flex-1 space-y-8">
            {/* Sort options (Agentver only) */}
            {isAgentver && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {category && (
                    <button
                      type="button"
                      onClick={() => setCategory(null)}
                      className="rounded-full bg-primary/10 px-3 py-1 text-primary text-xs hover:bg-primary/20"
                    >
                      {category} &times;
                    </button>
                  )}
                </div>
                <SortSelect value={sort} onChange={setSort} />
              </div>
            )}

            {/* MCP category pill */}
            {isMcp && category && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCategory(null)}
                  className="rounded-full bg-primary/10 px-3 py-1 text-primary text-xs hover:bg-primary/20"
                >
                  {category} &times;
                </button>
              </div>
            )}

            {/* Trending section (Agentver only) */}
            {showTrending && (
              <>
                <FadeIn>
                  <TrendingSection />
                </FadeIn>
                <FadeIn delay={50}>
                  <McpPreviewSection onViewAll={() => handleSourceChange('mcp')} />
                </FadeIn>
              </>
            )}

            {/* Results grid */}
            <FadeIn delay={200}>
              {isAgentver && <ExploreResults query={query} category={category} sort={sort} />}
              {isMcp && <McpResults query={query} category={category} />}
            </FadeIn>
          </div>
        </div>
      ) : (
        <FadeIn delay={150}>
          <div className="min-w-0 space-y-8">
            <CommunityResults query={query} />
          </div>
        </FadeIn>
      )}
    </div>
  )
}
