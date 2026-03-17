'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agentver/ui/components/select'

type SortOption = 'trending' | 'stars' | 'installs' | 'updated'

type SortSelectProps = {
  value: SortOption
  onChange: (value: SortOption) => void
}

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'trending', label: 'Trending' },
  { value: 'stars', label: 'Most Stars' },
  { value: 'installs', label: 'Most Installs' },
  { value: 'updated', label: 'Recently Updated' },
]

export function SortSelect({ value, onChange }: SortSelectProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SortOption)}>
      <SelectTrigger className="w-44">
        <SelectValue placeholder="Sort by" />
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export type { SortOption }
