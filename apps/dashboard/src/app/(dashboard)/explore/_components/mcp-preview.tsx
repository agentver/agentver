'use client'

import { Skeleton } from '@agentver/ui/components/skeleton'
import { cn } from '@agentver/ui-utils'
import { BadgeCheck, Download, Server } from 'lucide-react'
import Link from 'next/link'
import { formatCount } from '@/components/install-badge'
import { trpc } from '@/trpc/client'

const TRANSPORT_COLOURS: Record<string, string> = {
  stdio: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  http: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  sse: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
}

type McpPreviewSectionProps = {
  onViewAll: () => void
}

export function McpPreviewSection({ onViewAll }: McpPreviewSectionProps) {
  const { data, isLoading } = trpc.mcpCatalogue.list.useQuery({
    verified: true,
    limit: 6,
  })

  const servers = data?.items ?? []

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Server className="size-5 text-primary" />
          <h3 className="font-display font-semibold text-lg tracking-tight">Popular MCP Servers</h3>
        </div>
        <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-72 shrink-0 rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  if (servers.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="size-5 text-primary" />
          <h3 className="font-display font-semibold text-lg tracking-tight">Popular MCP Servers</h3>
        </div>
        <button type="button" onClick={onViewAll} className="text-primary text-sm hover:underline">
          View all &rarr;
        </button>
      </div>
      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
        {servers.map((server) => (
          <Link key={server.id} href={`/mcp/${server.name}`} className="group w-72 shrink-0">
            <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/[0.04]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="flex items-center gap-1.5 truncate font-display font-semibold tracking-tight">
                    {server.displayName}
                    {server.verified && (
                      <span
                        className="inline-flex shrink-0 items-center text-blue-500"
                        aria-label="Verified"
                      >
                        <BadgeCheck className="size-3.5" />
                      </span>
                    )}
                  </h4>
                  <p className="mt-0.5 text-muted-foreground text-xs">by {server.author}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-0.5 font-medium text-xs',
                    TRANSPORT_COLOURS[server.transport] ?? 'bg-secondary text-secondary-foreground'
                  )}
                >
                  {server.transport}
                </span>
              </div>

              <p className="mt-2 line-clamp-2 flex-1 text-muted-foreground text-sm leading-relaxed">
                {server.description}
              </p>

              <div className="mt-auto pt-4">
                <div className="flex items-center gap-3 text-muted-foreground text-xs">
                  <span className="flex items-center gap-1">
                    <Download className="size-3" /> {formatCount(server.installCount)}
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
