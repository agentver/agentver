'use client'

import { cn } from '@agentver/ui-utils'
import { TRPCProvider } from '@/trpc/provider'
import { Breadcrumbs } from './breadcrumbs'
import { CommandPalette } from './command-palette'
import Header from './header'
import { Sidebar, SidebarMobileProvider, useSidebarMobile } from './sidebar'

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const { setMobileOpen, collapsed } = useSidebarMobile()

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div
        className={cn(
          'flex flex-1 flex-col transition-[padding] duration-200',
          collapsed ? 'md:pl-[var(--sidebar-width-collapsed)]' : 'md:pl-[var(--sidebar-width)]'
        )}
      >
        <Header onMenuToggle={() => setMobileOpen(true)}>
          <Breadcrumbs />
        </Header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8 md:px-8 md:py-10">
          {children}
        </main>
      </div>
      <CommandPalette />
    </div>
  )
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <TRPCProvider>
      <SidebarMobileProvider>
        <DashboardLayoutInner>{children}</DashboardLayoutInner>
      </SidebarMobileProvider>
    </TRPCProvider>
  )
}
