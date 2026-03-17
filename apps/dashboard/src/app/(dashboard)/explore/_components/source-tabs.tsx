'use client'

import { cn } from '@agentver/ui-utils'
import { Globe, Package, Server } from 'lucide-react'

export type ExploreSource = 'agentver' | 'community' | 'mcp'

type SourceTabsProps = {
  value: ExploreSource
  onChange: (value: ExploreSource) => void
}

const TABS: Array<{ value: ExploreSource; label: string; icon: typeof Package }> = [
  { value: 'agentver', label: 'Registry', icon: Package },
  { value: 'community', label: 'Community', icon: Globe },
  { value: 'mcp', label: 'MCP Servers', icon: Server },
]

export function SourceTabs({ value, onChange }: SourceTabsProps) {
  return (
    <div className="inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
      {TABS.map((tab) => {
        const Icon = tab.icon
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 font-medium text-sm transition-all',
              value === tab.value
                ? 'bg-background text-foreground shadow-sm'
                : 'hover:text-foreground'
            )}
          >
            <Icon className="size-3.5" />
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
