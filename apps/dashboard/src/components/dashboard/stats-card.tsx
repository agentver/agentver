'use client'

import { cn } from '@agentver/ui-utils'
import type { LucideIcon } from 'lucide-react'

type StatsCardProps = {
  title: string
  value: string | number
  icon: LucideIcon
  colour: string
  children?: React.ReactNode
}

export function StatsCard({ title, value, icon: Icon, colour, children }: StatsCardProps) {
  return (
    <div data-testid="stat-card" className="relative h-full overflow-hidden rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm">{title}</p>
          <p className="font-display font-semibold text-3xl tracking-tight">{value}</p>
        </div>
        <div
          className="flex size-10 items-center justify-center rounded-2xl"
          style={{
            backgroundColor: `color-mix(in oklch, ${colour} 10%, transparent)`,
            color: colour,
          }}
        >
          <Icon className="size-5" />
        </div>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}

type TypeBreakdownProps = {
  byType: Record<string, number>
  typeDisplay: Record<string, { label: string; colour: string }>
}

export function TypeBreakdown({ byType, typeDisplay }: TypeBreakdownProps) {
  const entries = Object.entries(byType).filter(([, count]) => count > 0)

  if (entries.length === 0) {
    return <p className="text-muted-foreground text-xs">No packages yet</p>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([type, count]) => {
        const display = typeDisplay[type]
        if (!display) return null

        return (
          <span
            key={type}
            className={cn('rounded-full px-2 py-0.5 font-medium text-xs', display.colour)}
          >
            {count} {display.label}
            {count !== 1 ? 's' : ''}
          </span>
        )
      })}
    </div>
  )
}
