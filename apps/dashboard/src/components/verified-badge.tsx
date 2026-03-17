'use client'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agentver/ui/components/tooltip'
import { cn } from '@agentver/ui-utils'
import { BadgeCheck } from 'lucide-react'

type VerifiedBadgeProps = {
  className?: string
  size?: 'sm' | 'md'
}

export function VerifiedBadge({ className, size = 'sm' }: VerifiedBadgeProps) {
  const iconSize = size === 'sm' ? 'size-3.5' : 'size-4'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn('inline-flex shrink-0 items-center text-blue-500', className)}
            aria-label="Verified Publisher"
          >
            <BadgeCheck className={iconSize} />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>Verified Publisher</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
