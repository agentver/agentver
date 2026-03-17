'use client'

import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from '@agentver/ui/components/dialog'
import { cn } from '@agentver/ui-utils'
import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  BookOpen,
  Compass,
  FolderOpen,
  Key,
  LayoutDashboard,
  Package,
  Plus,
  Search,
  Settings,
  User,
  Users,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Command = {
  id: string
  label: string
  icon: LucideIcon
  section: string
  href?: string
  action?: () => void
  keywords?: string[]
}

const STATIC_COMMANDS: Omit<Command, 'action'>[] = [
  // Navigation
  {
    id: 'nav-dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    section: 'Navigation',
    href: '/',
    keywords: ['home', 'overview'],
  },
  {
    id: 'nav-explore',
    label: 'Explore',
    icon: Compass,
    section: 'Navigation',
    href: '/explore',
    keywords: ['browse', 'discover', 'search'],
  },
  {
    id: 'nav-packages',
    label: 'Packages',
    icon: Package,
    section: 'Navigation',
    href: '/skills',
    keywords: ['skills', 'registry'],
  },
  {
    id: 'nav-collections',
    label: 'Collections',
    icon: FolderOpen,
    section: 'Navigation',
    href: '/collections',
    keywords: ['groups', 'bundles'],
  },
  {
    id: 'nav-sources',
    label: 'Sources',
    icon: BookOpen,
    section: 'Navigation',
    href: '/sources',
    keywords: ['git', 'repositories'],
  },
  {
    id: 'nav-analytics',
    label: 'Analytics',
    icon: BarChart3,
    section: 'Navigation',
    href: '/analytics',
    keywords: ['stats', 'metrics', 'usage'],
  },
  {
    id: 'nav-settings',
    label: 'Settings',
    icon: Settings,
    section: 'Navigation',
    href: '/settings',
    keywords: ['preferences', 'configuration'],
  },

  // Actions
  {
    id: 'action-create-package',
    label: 'Create Package',
    icon: Plus,
    section: 'Actions',
    href: '/skills/new',
    keywords: ['new', 'add', 'register', 'skill'],
  },
  {
    id: 'action-create-collection',
    label: 'Create Collection',
    icon: Plus,
    section: 'Actions',
    href: '/collections/new',
    keywords: ['new', 'add', 'group'],
  },
  {
    id: 'action-docs',
    label: 'View Documentation',
    icon: BookOpen,
    section: 'Actions',
    keywords: ['help', 'guide', 'reference'],
  },

  // Settings
  {
    id: 'settings-profile',
    label: 'Profile',
    icon: User,
    section: 'Settings',
    href: '/settings/profile',
    keywords: ['account', 'user'],
  },
  {
    id: 'settings-organisation',
    label: 'Organisation',
    icon: Users,
    section: 'Settings',
    href: '/settings/organisation',
    keywords: ['org', 'team', 'company'],
  },
  {
    id: 'settings-teams',
    label: 'Teams',
    icon: Users,
    section: 'Settings',
    href: '/settings/teams',
    keywords: ['groups', 'members'],
  },
  {
    id: 'settings-api-keys',
    label: 'API Keys',
    icon: Key,
    section: 'Settings',
    href: '/settings/api-keys',
    keywords: ['tokens', 'authentication', 'credentials'],
  },
]

const SECTION_ORDER = ['Navigation', 'Actions', 'Settings']

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const commands: Command[] = useMemo(
    () =>
      STATIC_COMMANDS.map((cmd) => {
        if (cmd.id === 'action-docs') {
          return { ...cmd, action: () => window.open('https://agentver.com/docs', '_blank') }
        }
        return {
          ...cmd,
          action: cmd.href ? () => router.push(cmd.href as string) : undefined,
        }
      }),
    [router]
  )

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands

    const lowerQuery = query.toLowerCase()
    return commands.filter((cmd) => {
      if (cmd.label.toLowerCase().includes(lowerQuery)) return true
      if (cmd.section.toLowerCase().includes(lowerQuery)) return true
      return cmd.keywords?.some((kw) => kw.includes(lowerQuery)) ?? false
    })
  }, [commands, query])

  const groupedCommands = useMemo(() => {
    const groups = new Map<string, Command[]>()
    for (const cmd of filteredCommands) {
      const existing = groups.get(cmd.section) ?? []
      existing.push(cmd)
      groups.set(cmd.section, existing)
    }

    return SECTION_ORDER.filter((section) => groups.has(section)).map((section) => ({
      section,
      commands: groups.get(section) as Command[],
    }))
  }, [filteredCommands])

  const flatCommands = useMemo(() => groupedCommands.flatMap((g) => g.commands), [groupedCommands])

  const executeCommand = useCallback(
    (cmd: Command) => {
      setOpen(false)
      setQuery('')
      if (cmd.href) {
        router.push(cmd.href)
      } else if (cmd.action) {
        cmd.action()
      }
    },
    [router]
  )

  // Keyboard shortcut to open palette
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      // Focus input after dialog animation
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [open])

  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex triggers scroll to active item
  useEffect(() => {
    if (!listRef.current) return
    const selectedElement = listRef.current.querySelector('[data-selected="true"]')
    selectedElement?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // biome-ignore lint/correctness/useExhaustiveDependencies: query change resets selection index
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  function handleKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % Math.max(flatCommands.length, 1))
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        setSelectedIndex((prev) => (prev <= 0 ? Math.max(flatCommands.length - 1, 0) : prev - 1))
        break
      }
      case 'Enter': {
        event.preventDefault()
        const cmd = flatCommands[selectedIndex]
        if (cmd) executeCommand(cmd)
        break
      }
      case 'Escape': {
        event.preventDefault()
        setOpen(false)
        break
      }
    }
  }

  let runningIndex = -1

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPortal>
        <DialogOverlay className="bg-black/50 backdrop-blur-sm" />
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
          <div
            className={cn(
              'w-full max-w-lg overflow-hidden rounded-xl border border-border bg-background shadow-2xl',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
              'data-[state=closed]:animate-out data-[state=open]:animate-in'
            )}
            data-state={open ? 'open' : 'closed'}
            role="dialog"
            aria-label="Command palette"
            onKeyDown={handleKeyDown}
          >
            {/* Visually hidden title for accessibility */}
            <DialogTitle className="sr-only">Command palette</DialogTitle>

            {/* Search input */}
            <div className="flex items-center gap-3 border-border/60 border-b px-4">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command or search..."
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                aria-label="Search commands"
                aria-autocomplete="list"
                aria-controls="command-list"
                aria-activedescendant={
                  flatCommands[selectedIndex]
                    ? `command-${flatCommands[selectedIndex]?.id}`
                    : undefined
                }
              />
              <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs sm:inline-block">
                Esc
              </kbd>
            </div>

            {/* Results */}
            <div
              ref={listRef}
              id="command-list"
              role="listbox"
              className="max-h-80 overflow-y-auto overscroll-contain p-2"
            >
              {flatCommands.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  No results found.
                </div>
              ) : (
                groupedCommands.map((group) => (
                  <div key={group.section} className="mb-2 last:mb-0">
                    <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
                      {group.section}
                    </div>
                    {group.commands.map((cmd) => {
                      runningIndex++
                      const isSelected = runningIndex === selectedIndex
                      const currentIndex = runningIndex

                      return (
                        <button
                          key={cmd.id}
                          id={`command-${cmd.id}`}
                          role="option"
                          type="button"
                          aria-selected={isSelected}
                          data-selected={isSelected}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                            isSelected
                              ? 'bg-accent text-accent-foreground'
                              : 'text-foreground hover:bg-accent/50'
                          )}
                          onClick={() => executeCommand(cmd)}
                          onMouseEnter={() => setSelectedIndex(currentIndex)}
                        >
                          <cmd.icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="flex-1">{cmd.label}</span>
                          {cmd.href && (
                            <span className="font-mono text-muted-foreground/50 text-xs">
                              {cmd.href}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-border/60 border-t px-4 py-2">
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                  &uarr;&darr;
                </kbd>
                <span>Navigate</span>
                <kbd className="ml-1 rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                  &crarr;
                </kbd>
                <span>Select</span>
              </div>
              <div className="text-muted-foreground/50 text-xs">
                {flatCommands.length} {flatCommands.length === 1 ? 'result' : 'results'}
              </div>
            </div>
          </div>
        </div>
      </DialogPortal>
    </Dialog>
  )
}
