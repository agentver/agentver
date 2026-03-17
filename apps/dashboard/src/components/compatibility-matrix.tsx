'use client'

import { cn } from '@agentver/ui-utils'
import { Check, X } from 'lucide-react'
import { AGENT_DISPLAY } from '@/lib/agent-display'

type CompatibilityMatrixProps = {
  supportedAgents: string[]
  className?: string
  compact?: boolean
}

const ALL_AGENTS = Object.keys(AGENT_DISPLAY)

export function CompatibilityMatrix({
  supportedAgents,
  className,
  compact,
}: CompatibilityMatrixProps) {
  const supported = new Set(supportedAgents.map((a) => a.toLowerCase()))

  return (
    <div className={cn('rounded-lg border border-border', className)}>
      <div
        className={cn(
          'grid items-center gap-2 p-3',
          compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
        )}
      >
        {ALL_AGENTS.map((agentKey) => {
          const display = AGENT_DISPLAY[agentKey]
          if (!display) return null
          const isSupported = supported.has(agentKey)

          return (
            <div
              key={agentKey}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                isSupported
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'bg-muted/50 text-muted-foreground'
              )}
            >
              {isSupported ? (
                <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <X className="size-3.5 shrink-0 text-muted-foreground/50" />
              )}
              <span className="truncate font-medium text-xs">{display.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
