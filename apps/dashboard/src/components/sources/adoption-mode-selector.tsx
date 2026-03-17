'use client'

import { cn } from '@agentver/ui-utils'
import { Copy, GitCompareArrows, Link } from 'lucide-react'

type AdoptionMode = 'COPY' | 'MIRROR' | 'LINK'

type AdoptionModeOption = {
  value: AdoptionMode
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const ADOPTION_MODES: AdoptionModeOption[] = [
  {
    value: 'COPY',
    label: 'Copy',
    description: 'Import a snapshot into Agentver. No ongoing link to the source.',
    icon: Copy,
  },
  {
    value: 'MIRROR',
    label: 'Mirror',
    description: 'Import and keep in sync. Detect upstream changes and review updates.',
    icon: GitCompareArrows,
  },
  {
    value: 'LINK',
    label: 'Link',
    description: 'Keep files at source. Content is fetched on demand — you own your data.',
    icon: Link,
  },
]

type AdoptionModeSelectorProps = {
  value: AdoptionMode
  onChange: (mode: AdoptionMode) => void
  disabledModes?: Partial<Record<AdoptionMode, string>>
}

export function AdoptionModeSelector({
  value,
  onChange,
  disabledModes,
}: AdoptionModeSelectorProps) {
  return (
    <div className="space-y-2">
      <p className="font-medium text-sm">Import Mode</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {ADOPTION_MODES.map((mode) => {
          const isSelected = value === mode.value
          const disabledReason = disabledModes?.[mode.value]
          const isDisabled = !!disabledReason
          const Icon = mode.icon
          return (
            <button
              key={mode.value}
              type="button"
              disabled={isDisabled}
              onClick={() => onChange(mode.value)}
              className={cn(
                'flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors',
                isDisabled && 'cursor-not-allowed opacity-50',
                !isDisabled && isSelected && 'border-primary bg-primary/5',
                !isDisabled && !isSelected && 'border-border hover:border-muted-foreground/50',
                isDisabled && 'border-border'
              )}
            >
              <div className="flex items-center gap-2">
                <Icon
                  className={cn('size-4', isSelected ? 'text-primary' : 'text-muted-foreground')}
                />
                <span className="font-medium text-sm">{mode.label}</span>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {isDisabled ? disabledReason : mode.description}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
