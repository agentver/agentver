'use client'

import { Input } from '@agentver/ui/components/input'
import { Skeleton } from '@agentver/ui/components/skeleton'
import { cn } from '@agentver/ui-utils'
import { BadgeCheck, BookOpen, Download, LayoutGrid, Search, Server, Terminal } from 'lucide-react'
import Link from 'next/link'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { FadeIn } from '@/components/fade-in'
import { formatCount } from '@/components/install-badge'
import { trpc } from '@/trpc/client'

function McpSearchBar({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault()
      inputRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="relative">
      <Search className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="text"
        placeholder="Search MCP servers..."
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="h-11 rounded-xl pr-16 pl-10 text-sm"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs sm:inline-flex">
        <span className="text-[10px]">&#8984;</span>K
      </kbd>
    </div>
  )
}

function McpCategorySidebar({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (category: string | null) => void
}) {
  const { data, isLoading } = trpc.mcpCatalogue.categories.useQuery()

  if (isLoading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 rounded-lg" />
        ))}
      </div>
    )
  }

  const categories = data ?? []

  return (
    <nav className="space-y-0.5">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
          selected === null
            ? 'bg-primary/10 font-medium text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        <LayoutGrid className="size-4 shrink-0" />
        <span className="flex-1">All</span>
      </button>

      {categories.map((category) => (
        <button
          key={category}
          type="button"
          onClick={() => onSelect(category)}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
            selected === category
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <span className="flex-1 truncate">{category}</span>
        </button>
      ))}
    </nav>
  )
}

const TRANSPORT_COLOURS: Record<string, string> = {
  stdio: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  http: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  sse: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
}

function McpServerCard({
  name,
  displayName,
  description,
  author,
  transport,
  verified,
  installCount,
}: {
  name: string
  displayName: string
  description: string
  author: string
  transport: string
  verified: boolean
  installCount: number
}) {
  return (
    <Link href={`/mcp/${name}`}>
      <div className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/[0.04]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 truncate font-display font-semibold tracking-tight">
              {displayName}
              {verified && (
                <span
                  className="inline-flex shrink-0 items-center text-blue-500"
                  aria-label="Verified"
                >
                  <BadgeCheck className="size-3.5" />
                </span>
              )}
            </h3>
            <p className="mt-0.5 text-muted-foreground text-xs">by {author}</p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-0.5 font-medium text-xs',
              TRANSPORT_COLOURS[transport] ?? 'bg-secondary text-secondary-foreground'
            )}
          >
            {transport}
          </span>
        </div>

        <p className="mt-2 line-clamp-2 flex-1 text-muted-foreground text-sm leading-relaxed">
          {description}
        </p>

        <div className="mt-auto pt-4">
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <span className="flex items-center gap-1">
              <Download className="size-3" /> {formatCount(installCount)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function McpServerGrid({ query, category }: { query: string; category: string | null }) {
  const searchEnabled = query.length > 0

  const searchResult = trpc.mcpCatalogue.search.useQuery(
    { query, limit: 20 },
    { enabled: searchEnabled }
  )

  const browseResult = trpc.mcpCatalogue.list.useQuery(
    {
      category: category ?? undefined,
      limit: 50,
    },
    { enabled: !searchEnabled }
  )

  const isLoading = searchEnabled ? searchResult.isLoading : browseResult.isLoading
  const items = searchEnabled ? (searchResult.data ?? []) : (browseResult.data?.items ?? [])

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-2xl" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-light text-primary">
          {query ? <Search className="size-5" /> : <Server className="size-5" />}
        </div>
        <p className="mt-4 font-display font-semibold text-lg">
          {query ? 'No results found' : 'No MCP servers yet'}
        </p>
        <p className="mt-1 max-w-sm text-muted-foreground text-sm">
          {query
            ? `No MCP servers matching "${query}". Try a different search term.`
            : 'The curated MCP server catalogue will appear here once seeded. Run the seed script to populate it with popular servers like GitHub, Slack, and PostgreSQL.'}
        </p>
        {!query && (
          <code className="mt-4 rounded-lg border border-border bg-muted px-4 py-2 font-mono text-sm">
            <Terminal className="mr-2 inline size-3.5" />
            bunx tsx prisma/seed-mcp-catalogue.ts
          </code>
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((server) => (
        <McpServerCard
          key={server.id}
          name={server.name}
          displayName={server.displayName}
          description={server.description}
          author={server.author}
          transport={server.transport}
          verified={server.verified}
          installCount={server.installCount}
        />
      ))}
    </div>
  )
}

function McpPageContent() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-semibold text-2xl tracking-tight">MCP Servers</h2>
        <p className="text-muted-foreground">
          Browse and discover Model Context Protocol servers to extend your AI agents.
        </p>
      </div>

      <McpSearchBar value={query} onChange={setQuery} />

      <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/50 p-3 text-sm">
        <BookOpen className="size-4 shrink-0 text-primary" />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Curated catalogue</span> — verified MCP
          server definitions ready to use with your AI agents. Install via the CLI with{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            agentver mcp add &lt;name&gt;
          </code>
        </p>
      </div>

      <div className="flex gap-8">
        <aside className="hidden w-48 shrink-0 lg:block">
          <h3 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
            Categories
          </h3>
          <McpCategorySidebar selected={category} onSelect={setCategory} />
        </aside>

        <div className="min-w-0 flex-1 space-y-8">
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
          </div>

          <FadeIn>
            <McpServerGrid query={query} category={category} />
          </FadeIn>
        </div>
      </div>
    </div>
  )
}

export default function McpPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div>
            <h2 className="font-display font-semibold text-2xl tracking-tight">MCP Servers</h2>
            <p className="text-muted-foreground">
              Browse and discover Model Context Protocol servers to extend your AI agents.
            </p>
          </div>
          <Skeleton className="h-11 rounded-xl" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-2xl" />
            ))}
          </div>
        </div>
      }
    >
      <McpPageContent />
    </Suspense>
  )
}
