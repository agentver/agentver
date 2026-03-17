import { cn } from '@agentver/ui-utils'
import { Copy, GitCompareArrows, Link } from 'lucide-react'
import { ADOPTION_MODE_DISPLAY, getSourceLabel, PROVIDER_DISPLAY } from '@/lib/source-display'

type SourceBadgeProps = {
  provider: string
  adoptionMode: string
  compact?: boolean
}

const MODE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  COPY: Copy,
  MIRROR: GitCompareArrows,
  LINK: Link,
}

export function SourceBadge({ provider, adoptionMode, compact }: SourceBadgeProps) {
  const modeDisplay = ADOPTION_MODE_DISPLAY[adoptionMode]
  if (!modeDisplay) return null

  const Icon = MODE_ICONS[adoptionMode]
  const label = compact
    ? (PROVIDER_DISPLAY[provider]?.label ?? provider)
    : getSourceLabel(provider, adoptionMode)

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs',
        modeDisplay.colour
      )}
    >
      {Icon && <Icon className="size-3" />}
      {label}
    </span>
  )
}
