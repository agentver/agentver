'use client'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agentver/ui/components/tooltip'
import { cn } from '@agentver/ui-utils'

type HelpTooltipProps = {
  content: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}

export function HelpTooltip({ content, side = 'top', className }: HelpTooltipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex size-4 cursor-help items-center justify-center rounded-full border border-border text-[10px] text-muted-foreground/60 hover:border-primary/30 hover:text-primary',
              className
            )}
            aria-label="Help"
          >
            ?
          </span>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs">
          <p>{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
