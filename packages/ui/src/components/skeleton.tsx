import { cn } from '@agentver/ui-utils'
import type { HTMLAttributes } from 'react'

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-2xl bg-muted', className)} {...props} />
}

export { Skeleton }
