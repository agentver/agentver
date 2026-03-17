'use client'

import { LogoIcon } from '@agentver/ui/components/logo'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agentver/ui/components/tooltip'
import { cn } from '@agentver/ui-utils'
import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  BookOpen,
  Compass,
  ExternalLink,
  FolderOpen,
  LayoutDashboard,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings,
  Shield,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  createContext,
  type Dispatch,
  type SetStateAction,
  useContext,
  useEffect,
  useState,
} from 'react'
import { useSession } from '@/lib/auth/client'
import { trpc } from '@/trpc/client'

const COLLAPSED_STORAGE_KEY = 'sidebar-collapsed'

const isCloudEdition = process.env.NEXT_PUBLIC_AGENTVER_CLOUD === 'true'
const adminEmails = (process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

// --- Navigation structure ---

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
}

type NavSection = {
  label: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    label: 'Main',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/explore', label: 'Explore', icon: Compass },
    ],
  },
  {
    label: 'Your Workspace',
    items: [
      { href: '/skills', label: 'Packages', icon: Package },
      { href: '/collections', label: 'Collections', icon: FolderOpen },
      { href: '/sources', label: 'Sources', icon: Plug },
    ],
  },
  {
    label: 'Insights',
    items: [{ href: '/analytics', label: 'Analytics', icon: BarChart3 }],
  },
]

// --- Notification badge helpers (exported for header use) ---

export function formatBadgeCount(count: number): string {
  if (count > 99) return '99+'
  return String(count)
}

export function useUnreadNotificationCount() {
  const { data } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30_000,
  })
  return data?.count ?? 0
}

// --- Sidebar context (mobile + collapsed state) ---

type SidebarContextValue = {
  mobileOpen: boolean
  setMobileOpen: Dispatch<SetStateAction<boolean>>
  collapsed: boolean
  setCollapsed: Dispatch<SetStateAction<boolean>>
}

const SidebarContext = createContext<SidebarContextValue>({
  mobileOpen: false,
  setMobileOpen: () => {},
  collapsed: false,
  setCollapsed: () => {},
})

export function SidebarMobileProvider({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'
  })

  useEffect(() => {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed))
  }, [collapsed])

  return (
    <SidebarContext.Provider value={{ mobileOpen, setMobileOpen, collapsed, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebarMobile() {
  return useContext(SidebarContext)
}

// --- Components ---

function SectionLabel({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) return null

  return (
    <p className="mb-2 px-3 font-medium text-sidebar-foreground/40 text-xs uppercase tracking-wider">
      {label}
    </p>
  )
}

function NavLink({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  onClick?: () => void
}) {
  const link = (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-150',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
      )}
    >
      <item.icon className="size-[18px] shrink-0" />
      {!collapsed && <span className="flex-1">{item.label}</span>}
    </Link>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    )
  }

  return link
}

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { mobileOpen, setMobileOpen, collapsed, setCollapsed } = useSidebarMobile()

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  const closeMobileOnNavigate = () => {
    setMobileOpen(false)
  }

  const isAdmin =
    isCloudEdition &&
    !!session?.user?.email &&
    adminEmails.includes(session.user.email.toLowerCase())

  const sidebarContent = (
    <aside
      className={cn(
        'fixed top-0 left-0 z-40 flex h-full flex-col border-border/50 border-r bg-sidebar transition-[width] duration-200',
        collapsed ? 'w-[var(--sidebar-width-collapsed)]' : 'w-[var(--sidebar-width)]',
        'max-md:hidden'
      )}
    >
      {/* Header with logo and collapse toggle */}
      <div
        className={cn(
          'flex pt-7 pb-6',
          collapsed ? 'flex-col items-center gap-2 px-2' : 'items-center justify-between px-6'
        )}
      >
        <Link
          href="/"
          className={cn(
            'flex items-center font-display font-semibold text-foreground tracking-tight',
            collapsed ? 'justify-center' : 'gap-2.5 text-lg'
          )}
        >
          <LogoIcon className="h-7 w-auto shrink-0 text-primary" />
          {!collapsed && 'agentver'}
        </Link>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setCollapsed((prev) => !prev)}
              className="rounded-md p-1.5 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Navigation sections */}
      <nav className={cn('flex-1 space-y-0.5 overflow-y-auto', collapsed ? 'px-2' : 'px-3')}>
        {navSections.map((section, sectionIndex) => (
          <div key={section.label} className={cn(sectionIndex > 0 && 'mt-6')}>
            <SectionLabel label={section.label} collapsed={collapsed} />
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isActive(item.href)}
                  collapsed={collapsed}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Settings link */}
        <div className="mt-6">
          {!collapsed && <div className="my-4 h-px bg-border/60" />}
          <NavLink
            item={{ href: '/settings/profile', label: 'Settings', icon: Settings }}
            active={isActive('/settings')}
            collapsed={collapsed}
          />
        </div>

        {/* Admin section (cloud only) */}
        {isAdmin && (
          <div className="mt-2">
            {!collapsed && <div className="my-4 h-px bg-border/60" />}
            <NavLink
              item={{ href: '/admin', label: 'Admin', icon: Shield }}
              active={isActive('/admin')}
              collapsed={collapsed}
            />
          </div>
        )}
      </nav>

      {/* Bottom section: docs link */}
      <div className="border-border/50 border-t">
        <div className={cn('px-3 py-3', collapsed && 'px-2')}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="https://agentver.com/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center rounded-xl px-3 py-2 text-sidebar-foreground/70 text-sm transition-all duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                >
                  <BookOpen className="size-[18px] shrink-0" />
                </a>
              </TooltipTrigger>
              <TooltipContent side="right">Documentation</TooltipContent>
            </Tooltip>
          ) : (
            <a
              href="https://agentver.com/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl px-3 py-2 text-sidebar-foreground/70 text-sm transition-all duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            >
              <BookOpen className="size-[18px] shrink-0" />
              <span className="flex-1">Documentation</span>
              <ExternalLink className="size-3 text-sidebar-foreground/40" />
            </a>
          )}
        </div>
      </div>
    </aside>
  )

  /* Mobile sidebar: overlay drawer */
  const mobileSidebar = (
    <>
      {/* Backdrop overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={closeMobileOnNavigate}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeMobileOnNavigate()
          }}
          role="button"
          tabIndex={-1}
          aria-label="Close sidebar"
        />
      )}

      {/* Slide-in drawer */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 flex h-full w-[var(--sidebar-width)] flex-col border-border/50 border-r bg-sidebar transition-transform duration-200 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Mobile header */}
        <div className="flex items-center justify-between px-6 pt-7 pb-6">
          <Link
            href="/"
            onClick={closeMobileOnNavigate}
            className="flex items-center gap-2.5 font-display font-semibold text-foreground text-lg tracking-tight"
          >
            <LogoIcon className="h-7 w-auto text-primary" />
            agentver
          </Link>
          <button
            type="button"
            onClick={closeMobileOnNavigate}
            className="rounded-md p-1.5 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>

        {/* Mobile navigation */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {navSections.map((section, sectionIndex) => (
            <div key={section.label} className={cn(sectionIndex > 0 && 'mt-6')}>
              <SectionLabel label={section.label} collapsed={false} />
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={isActive(item.href)}
                    collapsed={false}
                    onClick={closeMobileOnNavigate}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Settings */}
          <div className="mt-6">
            <div className="my-4 h-px bg-border/60" />
            <NavLink
              item={{ href: '/settings/profile', label: 'Settings', icon: Settings }}
              active={isActive('/settings')}
              collapsed={false}
              onClick={closeMobileOnNavigate}
            />
          </div>

          {/* Admin (cloud only) */}
          {isAdmin && (
            <div className="mt-2">
              <div className="my-4 h-px bg-border/60" />
              <NavLink
                item={{ href: '/admin', label: 'Admin', icon: Shield }}
                active={isActive('/admin')}
                collapsed={false}
                onClick={closeMobileOnNavigate}
              />
            </div>
          )}
        </nav>

        {/* Mobile bottom section */}
        <div className="border-border/50 border-t">
          <div className="px-3 py-3">
            <a
              href="https://agentver.com/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl px-3 py-2 text-sidebar-foreground/70 text-sm transition-all duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            >
              <BookOpen className="size-[18px] shrink-0" />
              <span className="flex-1">Documentation</span>
              <ExternalLink className="size-3 text-sidebar-foreground/40" />
            </a>
          </div>
        </div>
      </aside>
    </>
  )

  return (
    <TooltipProvider delayDuration={0}>
      {sidebarContent}
      {mobileSidebar}
    </TooltipProvider>
  )
}
