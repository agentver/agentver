import { cn } from '@agentver/ui-utils'
import { useState } from 'react'
import { ProjectContext } from '../context/ProjectContext'
import { useNotifications } from '../hooks/useNotifications'
import { useProjectSelector } from '../hooks/useProjectSelector'
import { Agents } from '../pages/Agents'
import { CreateSkill, PlusIcon } from '../pages/CreateSkill'
import { Dashboard } from '../pages/Dashboard'
import { EditorPage } from '../pages/Editor'
import { Login } from '../pages/Login'
import { Proposals } from '../pages/Proposals'
import { Settings } from '../pages/Settings'
import { Browser } from '../pages/skills/Browser'
import { Discover } from '../pages/skills/Discover'
import { Installed } from '../pages/skills/Installed'
import type { AuthProps, Page } from '../types'
import { NotificationBell, NotificationPanel } from './NotificationPanel'
import { OfflineIndicator } from './offline-indicator'
import { ProjectSelector } from './ProjectSelector'
import { RepoWizard } from './repo-wizard'
import { SignInBanner } from './sign-in-banner'

type AppShellProps = {
  auth: AuthProps
}

type NavItem = {
  id: Page
  label: string
  icon: React.ReactNode
  section?: string
}

function HomeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7.5L9 2.5l6 5v7a1 1 0 01-1 1H4a1 1 0 01-1-1v-7z" />
      <path d="M7 15.5v-5h4v5" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="5" />
      <path d="M15 15l-3.5-3.5" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4h12M3 9h12M3 14h12" />
      <circle cx="3" cy="4" r="0.5" fill="currentColor" />
      <circle cx="3" cy="9" r="0.5" fill="currentColor" />
      <circle cx="3" cy="14" r="0.5" fill="currentColor" />
    </svg>
  )
}

function CpuIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="10" height="10" rx="1" />
      <rect x="6.5" y="6.5" width="5" height="5" rx="0.5" />
      <path d="M7 1v3M11 1v3M7 14v3M11 14v3M1 7h3M1 11h3M14 7h3M14 11h3" />
    </svg>
  )
}

function GitMergeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="4" r="2" />
      <circle cx="6" cy="14" r="2" />
      <circle cx="14" cy="10" r="2" />
      <path d="M6 6v6" />
      <path d="M6 6c0 4 8 0 8 4" />
    </svg>
  )
}

function CompassIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="9" r="7" />
      <polygon points="12,6 7.5,7.5 6,12 10.5,10.5" fill="currentColor" opacity="0.3" />
      <polygon points="12,6 7.5,7.5 6,12 10.5,10.5" />
    </svg>
  )
}

function CodeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 4.5L2 9l4 4.5M12 4.5l4 4.5-4 4.5M10 3l-2 12" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="9" r="2.5" />
      <path d="M9 1.5l1 2.1a5.5 5.5 0 012.4 1.4l2.1-1 1.5 2.5-2 1.2a5.5 5.5 0 010 2.6l2 1.2-1.5 2.5-2.1-1A5.5 5.5 0 0110 14.4l-1 2.1h-3l-1-2.1a5.5 5.5 0 01-2.4-1.4l-2.1 1L0 11.5l2-1.2a5.5 5.5 0 010-2.6L0 6.5 1.5 4l2.1 1A5.5 5.5 0 016 3.6L7 1.5h2z" />
    </svg>
  )
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <HomeIcon /> },
  { id: 'browse', label: 'Browse', icon: <SearchIcon />, section: 'Skills' },
  { id: 'discover', label: 'Discover', icon: <CompassIcon /> },
  { id: 'installed', label: 'Installed', icon: <ListIcon /> },
  { id: 'editor', label: 'Editor', icon: <CodeIcon /> },
  { id: 'agents', label: 'Agents', icon: <CpuIcon /> },
  { id: 'proposals', label: 'Proposals', icon: <GitMergeIcon /> },
  { id: 'settings', label: 'Settings', icon: <GearIcon /> },
]

function renderPage(
  page: Page,
  auth: AuthProps,
  onNavigate: (page: Page) => void,
  onOpenRepoWizard: () => void
) {
  switch (page) {
    case 'dashboard':
      return <Dashboard auth={auth} onNavigate={onNavigate} onOpenRepoWizard={onOpenRepoWizard} />
    case 'browse':
      return <Browser />
    case 'discover':
      return <Discover />
    case 'installed':
      return <Installed />
    case 'editor':
      return <EditorPage skillPath={null} skillName={null} />
    case 'agents':
      return <Agents />
    case 'proposals':
      return <Proposals />
    case 'settings':
      return <Settings auth={auth} onNavigate={onNavigate} />
    case 'login':
      return (
        <Login
          onAuthenticated={() => onNavigate('dashboard')}
          onSkip={() => onNavigate('dashboard')}
          signInWithAPIKey={auth.signInWithAPIKey}
          isLoading={auth.isLoading}
          error={auth.error}
        />
      )
  }
}

export function AppShell({ auth }: AppShellProps) {
  const [activePage, setActivePage] = useState<Page>('dashboard')
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false)
  const [createSkillOpen, setCreateSkillOpen] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [repoWizardOpen, setRepoWizardOpen] = useState(false)
  const project = useProjectSelector()
  const {
    notifications,
    unreadCount,
    loading: notificationsLoading,
    markAsRead,
    markAllAsRead,
  } = useNotifications()

  const showSignInBanner = !auth.isAuthenticated && !bannerDismissed

  function handleNavigate(page: Page) {
    setActivePage(page)
  }

  function handleRepoComplete(repoPath: string) {
    project.setActiveProject(repoPath)
  }

  let lastSection: string | undefined

  return (
    <div className="flex h-full w-full">
      <aside className="flex w-60 min-w-60 flex-col justify-between border-sidebar-border border-r bg-sidebar">
        <div className="flex flex-col gap-2 py-4">
          <div className="flex items-center gap-2.5 px-5 pt-1 pb-3">
            <svg width="24" height="24" viewBox="0 0 40 40" fill="none" className="text-primary">
              <rect width="40" height="40" rx="10" fill="currentColor" fillOpacity="0.15" />
              <path
                d="M12 28V16l8-6 8 6v12l-8 4-8-4z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                fill="none"
              />
              <path
                d="M20 22v6M12 16l8 6 8-6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span className="flex-1 font-[family-name:var(--font-display)] font-semibold text-[1.05rem] tracking-tight">
              Agentver
            </span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setCreateSkillOpen(true)}
                className="flex shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-1.5 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
                title="Create new skill"
              >
                <PlusIcon />
              </button>
              <div className="relative">
                <NotificationBell
                  unreadCount={unreadCount}
                  onClick={() => setNotificationPanelOpen((prev) => !prev)}
                />
                <NotificationPanel
                  open={notificationPanelOpen}
                  notifications={notifications}
                  unreadCount={unreadCount}
                  loading={notificationsLoading}
                  onClose={() => setNotificationPanelOpen(false)}
                  onMarkAsRead={markAsRead}
                  onMarkAllAsRead={markAllAsRead}
                />
              </div>
            </div>
          </div>

          <ProjectSelector
            activeProject={project.activeProject}
            recentProjects={project.recentProjects}
            loading={project.loading}
            onSelectProject={project.setActiveProject}
            onClearProject={project.clearActiveProject}
            onRemoveRecent={project.removeRecentProject}
          />

          <nav className="flex flex-col gap-0.5">
            {navItems.map((item) => {
              const showSection = item.section && item.section !== lastSection
              if (item.section) lastSection = item.section

              const isActive = activePage === item.id

              return (
                <div key={item.id}>
                  {showSection && (
                    <div className="px-5 pt-3 pb-1 font-semibold text-[0.65rem] text-muted-foreground uppercase tracking-widest">
                      {item.section}
                    </div>
                  )}
                  <button
                    onClick={() => setActivePage(item.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 border-transparent border-l-3 px-5 py-2 font-normal text-sm transition-colors',
                      'cursor-pointer border-none text-left font-[inherit]',
                      isActive
                        ? 'border-l-3 border-l-primary bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-muted-foreground hover:text-sidebar-foreground'
                    )}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center">
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </button>
                </div>
              )
            })}
          </nav>
        </div>

        <div className="border-sidebar-border border-t px-4 py-3">
          <OfflineIndicator />
          <div className="my-2 h-px bg-sidebar-border" />
          {auth.isAuthenticated && auth.user ? (
            <div className="flex items-center gap-2">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <span className="font-semibold text-primary text-xs">
                  {auth.user.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate font-medium text-[0.8rem] text-sidebar-foreground">
                  {auth.user.name}
                </span>
                <span className="truncate text-[0.7rem] text-muted-foreground">
                  {auth.user.email}
                </span>
              </div>
              <button
                onClick={() => auth.signOut()}
                className="flex shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent p-1 text-muted-foreground transition-colors hover:text-destructive"
                title="Sign out"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 1.5H3a1 1 0 00-1 1v9a1 1 0 001 1h2M9.5 10l2.5-3-2.5-3M12 7H5" />
                </svg>
              </button>
            </div>
          ) : auth.isAuthenticated ? (
            <div className="flex items-center gap-2">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="#22c55e"
                  strokeWidth="1.2"
                >
                  <circle cx="8" cy="5.5" r="3" />
                  <path d="M2.5 14.5c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" />
                </svg>
              </div>
              <span className="font-medium text-[0.8rem] text-sidebar-foreground">Connected</span>
              <button
                onClick={() => auth.signOut()}
                className="flex shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent p-1 text-muted-foreground transition-colors hover:text-destructive"
                title="Sign out"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 1.5H3a1 1 0 00-1 1v9a1 1 0 001 1h2M9.5 10l2.5-3-2.5-3M12 7H5" />
                </svg>
              </button>
            </div>
          ) : (
            <div
              className="flex cursor-pointer items-center gap-2"
              onClick={() => setActivePage('login')}
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  className="text-muted-foreground"
                >
                  <circle cx="8" cy="5.5" r="3" />
                  <path d="M2.5 14.5c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" />
                </svg>
              </div>
              <span className="text-[0.825rem] text-muted-foreground">Sign in</span>
            </div>
          )}
        </div>
      </aside>

      <ProjectContext.Provider value={{ activeProject: project.activeProject }}>
        <div className="flex flex-1 flex-col overflow-hidden bg-background">
          {showSignInBanner && (
            <SignInBanner
              onSignIn={() => setActivePage('login')}
              onDismiss={() => setBannerDismissed(true)}
            />
          )}
          <main className="flex-1 overflow-auto bg-background">
            {renderPage(activePage, auth, handleNavigate, () => setRepoWizardOpen(true))}
          </main>
        </div>

        <CreateSkill open={createSkillOpen} onClose={() => setCreateSkillOpen(false)} />
        <RepoWizard
          open={repoWizardOpen}
          onClose={() => setRepoWizardOpen(false)}
          onComplete={handleRepoComplete}
        />
      </ProjectContext.Provider>
    </div>
  )
}
