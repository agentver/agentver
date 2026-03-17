'use client'

import { Input } from '@agentver/ui/components/input'
import { cn } from '@agentver/ui-utils'
import { Search, X } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'

type SearchBarProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search packages, skills, and MCP servers...',
  className,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault()
      inputRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className={cn('relative', className)}>
      <Search className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className={cn('h-11 rounded-xl pl-10 text-sm', value ? 'pr-10' : 'pr-16')}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-4" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs sm:inline-flex">
          <span className="text-[10px]">&#8984;</span>K
        </kbd>
      )}
    </div>
  )
}
