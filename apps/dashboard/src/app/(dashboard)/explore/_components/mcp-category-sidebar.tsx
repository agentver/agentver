'use client'

import { Skeleton } from '@agentver/ui/components/skeleton'
import { cn } from '@agentver/ui-utils'
import { LayoutGrid } from 'lucide-react'
import { trpc } from '@/trpc/client'

type McpCategorySidebarProps = {
  selected: string | null
  onSelect: (category: string | null) => void
}

export function McpCategorySidebar({ selected, onSelect }: McpCategorySidebarProps) {
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
    <nav className="space-y-1">
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
