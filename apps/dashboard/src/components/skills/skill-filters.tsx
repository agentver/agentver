'use client'

import { Button } from '@agentver/ui/components/button'
import { Input } from '@agentver/ui/components/input'
import { cn } from '@agentver/ui-utils'
import { Download, Grid3X3, List, Plus, Search } from 'lucide-react'
import Link from 'next/link'

type TypeFilter = {
  value: string
  label: string
}

const TYPE_FILTERS: TypeFilter[] = [
  { value: 'all', label: 'All' },
  { value: 'SKILL', label: 'Skills' },
  { value: 'AGENT_CONFIG', label: 'Configs' },
  { value: 'PLUGIN', label: 'Plugins' },
  { value: 'SCRIPT', label: 'Scripts' },
  { value: 'PROMPT', label: 'Prompts' },
  { value: 'AGENT', label: 'Agents' },
  { value: 'COMMAND', label: 'Commands' },
]

type SkillFiltersProps = {
  search: string
  onSearchChange: (value: string) => void
  type: string
  onTypeChange: (value: string) => void
  view: 'grid' | 'list'
  onViewChange: (value: 'grid' | 'list') => void
  onImportFromUrl?: () => void
  typeCounts?: Record<string, number>
}

export function SkillFilters({
  search,
  onSearchChange,
  type,
  onTypeChange,
  view,
  onViewChange,
  onImportFromUrl,
  typeCounts,
}: SkillFiltersProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div data-testid="type-filter" className="flex flex-wrap items-center gap-2">
        {TYPE_FILTERS.map((filter) => {
          const isActive = type === filter.value
          const count = typeCounts?.[filter.value]

          return (
            <button
              key={filter.value}
              type="button"
              onClick={() => onTypeChange(filter.value)}
              className={cn(
                'rounded-full border px-3 py-1.5 font-medium text-sm transition-colors',
                isActive
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/20 hover:text-foreground'
              )}
            >
              {filter.label}
              {count !== undefined ? ` (${count})` : ''}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search packages..."
            value={search}
            onChange={(e) => onSearchChange(e.currentTarget.value)}
            className="w-64 rounded-lg pl-9"
          />
        </div>
        <div className="flex rounded-lg border">
          <Button
            variant={view === 'grid' ? 'secondary' : 'ghost'}
            size="icon"
            className="rounded-r-none"
            onClick={() => onViewChange('grid')}
          >
            <Grid3X3 className="size-4" />
          </Button>
          <Button
            variant={view === 'list' ? 'secondary' : 'ghost'}
            size="icon"
            className="rounded-l-none"
            onClick={() => onViewChange('list')}
          >
            <List className="size-4" />
          </Button>
        </div>
        {onImportFromUrl && (
          <Button variant="outline" className="rounded-lg" onClick={onImportFromUrl}>
            <Download className="size-4" />
            Import from URL
          </Button>
        )}
        <Link href="/skills/new">
          <Button className="rounded-lg">
            <Plus className="size-4" />
            Register
          </Button>
        </Link>
      </div>
    </div>
  )
}
