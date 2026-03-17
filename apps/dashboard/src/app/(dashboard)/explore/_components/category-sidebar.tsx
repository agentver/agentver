'use client'

import { cn } from '@agentver/ui-utils'
import { LayoutGrid } from 'lucide-react'
import { trpc } from '@/trpc/client'

type CategorySidebarProps = {
  selected: string | null
  onSelect: (slug: string | null) => void
}

export function CategorySidebar({ selected, onSelect }: CategorySidebarProps) {
  const { data, isLoading } = trpc.categories.list.useQuery()

  if (isLoading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 animate-pulse rounded-2xl bg-muted" />
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
          key={category.id}
          type="button"
          onClick={() => onSelect(category.slug)}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
            selected === category.slug
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          {category.icon ? (
            <span className="size-4 shrink-0 text-center text-sm">{category.icon}</span>
          ) : (
            <span className="size-4 shrink-0" />
          )}
          <span className="flex-1 truncate">{category.name}</span>
          {category.packageCount > 0 && (
            <span className="text-muted-foreground/70 text-xs">{category.packageCount}</span>
          )}
        </button>
      ))}
    </nav>
  )
}
