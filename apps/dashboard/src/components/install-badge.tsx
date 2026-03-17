import { cn } from '@agentver/ui-utils'
import { Download } from 'lucide-react'

type InstallBadgeProps = {
  count: number
  className?: string
}

function formatCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  }
  return String(count)
}

export function InstallBadge({ count, className }: InstallBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs',
        className
      )}
    >
      <Download className="size-3" />
      {formatCount(count)}
    </span>
  )
}

export { formatCount }
