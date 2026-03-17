'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@agentver/ui/components/avatar'
import { Button } from '@agentver/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@agentver/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@agentver/ui/components/tooltip'
import { BookOpen, LogOut, Menu, Search, Settings } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { NotificationDropdown } from '@/components/notifications/notification-dropdown'
import { signOut, useSession } from '@/lib/auth/client'

type HeaderProps = {
  onMenuToggle?: () => void
  children?: React.ReactNode
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export default function Header({ onMenuToggle, children }: HeaderProps) {
  const { data: session } = useSession()
  const router = useRouter()

  async function handleSignOut() {
    await signOut()
    router.push('/sign-in')
  }

  return (
    <header className="sticky top-0 z-30 flex h-[var(--header-height)] items-center justify-between gap-4 border-border/50 border-b bg-background/80 px-6 backdrop-blur-md">
      {/* Left side: mobile menu toggle + breadcrumbs */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 md:hidden"
          onClick={onMenuToggle}
          aria-label="Toggle menu"
        >
          <Menu className="size-5" />
        </Button>

        {children}
      </div>

      {/* Centre: command palette trigger */}
      <button
        type="button"
        className="hidden w-64 items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-left text-muted-foreground text-sm transition-colors hover:border-border hover:bg-muted/50 md:flex"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1">Search...</span>
        <kbd className="pointer-events-none select-none rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      {/* Mobile: icon-only search trigger */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 md:hidden" aria-label="Search">
            <Search className="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Search</TooltipContent>
      </Tooltip>

      {/* Right side: docs, notifications, user avatar */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0" asChild>
              <a
                href="https://agentver.com/docs"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Documentation"
              >
                <BookOpen className="size-4" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Documentation</TooltipContent>
        </Tooltip>

        <NotificationDropdown />

        {session?.user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ml-1 flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Avatar className="size-8">
                  <AvatarImage src={session.user.image ?? undefined} />
                  <AvatarFallback className="text-xs">
                    {getInitials(session.user.name)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="font-medium text-sm leading-none">{session.user.name}</p>
                  <p className="text-muted-foreground text-xs leading-none">{session.user.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings/profile">
                  <Settings className="mr-2 size-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="mr-2 size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  )
}
