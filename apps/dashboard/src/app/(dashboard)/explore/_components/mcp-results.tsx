'use client'

import { Skeleton } from '@agentver/ui/components/skeleton'
import { cn } from '@agentver/ui-utils'
import { BadgeCheck, Download, Search, Server, Terminal } from 'lucide-react'
import Link from 'next/link'
import { FadeIn } from '@/components/fade-in'
import { formatCount } from '@/components/install-badge'
import { trpc } from '@/trpc/client'

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

type McpResultsProps = {
  query: string
  category: string | null
}

export function McpResults({ query, category }: McpResultsProps) {
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
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
    <FadeIn>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
    </FadeIn>
  )
}
