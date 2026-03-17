import { cn } from '@agentver/ui-utils'
import { AuthRequired } from '../components/auth-required'
import { useProject } from '../context/ProjectContext'
import { useAgents } from '../hooks/useAgents'
import { useInstalledSkills } from '../hooks/useInstalledSkills'
import type { AuthProps, Page } from '../types'

type DashboardProps = {
  auth: AuthProps
  onNavigate: (page: Page) => void
  onOpenRepoWizard: () => void
}

function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v8M4 7l4 4 4-4" />
      <path d="M2 12v2h12v-2" />
    </svg>
  )
}

function PlusCircleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 5v6M5 8h6" />
    </svg>
  )
}

function ScanIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 5V3a1 1 0 011-1h2M11 2h2a1 1 0 011 1v2M14 11v2a1 1 0 01-1 1h-2M5 14H3a1 1 0 01-1-1v-2" />
      <rect x="5" y="5" width="6" height="6" rx="0.5" />
    </svg>
  )
}

function GitRepoIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="3" r="1.5" />
      <circle cx="8" cy="13" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
      <path d="M8 4.5v7" />
      <path d="M8 6c0 2 5 1 5 2" />
    </svg>
  )
}

const AGENT_COLOURS: Record<string, string> = {
  'claude-code': '#a855f7',
  'claude-cowork': '#a855f7',
  cursor: '#3b82f6',
  copilot: '#22c55e',
  windsurf: '#14b8a6',
}

function getAgentDotColour(agentId: string): string {
  return AGENT_COLOURS[agentId] ?? '#666'
}

export function Dashboard({ auth, onNavigate, onOpenRepoWizard }: DashboardProps) {
  const { agents, skills: scannedSkills, loading: agentsLoading } = useAgents()
  const { skills: installedSkills } = useInstalledSkills()
  const { activeProject } = useProject()

  const recentSkills = installedSkills.slice(0, 5)

  return (
    <div className="mx-auto max-w-[960px] px-10 py-8">
      <div className="mb-6">
        <h1 className="mb-1 font-[family-name:var(--font-display)] font-semibold text-2xl text-foreground tracking-tight">
          Dashboard
        </h1>
        <p className="text-muted-foreground text-sm">Your agent skill manager</p>
      </div>

      <div className="mb-8 grid grid-cols-3 gap-4">
        {[
          { label: 'Agents Detected', value: agents.length },
          { label: 'Skills Managed', value: installedSkills.length },
          { label: 'Discovered', value: scannedSkills.length },
        ].map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5"
          >
            <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              {stat.label}
            </span>
            <span className="font-semibold text-2xl text-foreground">{stat.value}</span>
          </div>
        ))}
      </div>

      <div className="mb-6">
        <h2 className="pb-2 font-semibold text-[0.65rem] text-muted-foreground uppercase tracking-widest">
          QUICK ACTIONS
        </h2>
        <div className="grid grid-cols-4 gap-3">
          {[
            {
              id: 'install',
              label: 'Install skill',
              icon: <DownloadIcon />,
              action: () => onNavigate('browse'),
            },
            {
              id: 'create',
              label: 'Create skill',
              icon: <PlusCircleIcon />,
              action: () => onNavigate('browse'),
            },
            {
              id: 'scan',
              label: 'Scan for agents',
              icon: <ScanIcon />,
              action: () => onNavigate('agents'),
            },
            { id: 'repo', label: 'Set up repo', icon: <GitRepoIcon />, action: onOpenRepoWizard },
          ].map((item) => (
            <button
              key={item.id}
              onClick={item.action}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-border bg-card p-4 font-[inherit] transition-colors hover:border-primary"
            >
              <span className="flex items-center justify-center text-primary">{item.icon}</span>
              <span className="font-medium text-foreground text-xs">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="flex flex-col">
          <div className="mb-6">
            <h2 className="pb-2 font-semibold text-[0.65rem] text-muted-foreground uppercase tracking-widest">
              RECENT ACTIVITY
            </h2>
            <div className="rounded-2xl border border-border bg-card py-1">
              {recentSkills.length === 0 ? (
                <div className="flex items-center justify-between gap-3 px-5 py-4">
                  <span className="text-[0.825rem] text-muted-foreground">
                    No skills installed yet
                  </span>
                </div>
              ) : (
                recentSkills.map((skill) => (
                  <div key={skill.name} className="flex items-center gap-2.5 px-5 py-3">
                    <div className="size-1.5 shrink-0 rounded-full bg-primary" />
                    <div className="flex flex-1 items-center justify-between gap-2">
                      <span className="font-medium text-[0.85rem] text-foreground">
                        {skill.name}
                      </span>
                      <span className="font-mono text-muted-foreground text-xs">
                        {'version' in skill && typeof skill.version === 'string'
                          ? `v${skill.version}`
                          : 'installed'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mb-6">
            <h2 className="pb-2 font-semibold text-[0.65rem] text-muted-foreground uppercase tracking-widest">
              REPOSITORY
            </h2>
            <div className="rounded-2xl border border-border bg-card py-1">
              {activeProject ? (
                <>
                  <div className="flex items-start justify-between gap-4 px-5 py-3">
                    <span className="shrink-0 font-medium text-muted-foreground text-xs">Path</span>
                    <span className="break-all text-right font-mono text-foreground text-xs">
                      {activeProject}
                    </span>
                  </div>
                  <div className="mx-5 h-px bg-border" />
                  <div className="flex items-start justify-between gap-4 px-5 py-3">
                    <span className="shrink-0 font-medium text-muted-foreground text-xs">
                      Status
                    </span>
                    <div className="flex items-center gap-1.5">
                      <div className="size-1.5 rounded-full bg-green-500" />
                      <span className="font-medium text-green-500 text-xs">Active</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between gap-3 px-5 py-4">
                  <span className="text-[0.825rem] text-muted-foreground">
                    No repository connected
                  </span>
                  <button
                    onClick={onOpenRepoWizard}
                    className="shrink-0 cursor-pointer rounded-md border-none bg-primary px-3.5 py-1.5 font-medium text-[0.775rem] text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Connect
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mb-6">
            <h2 className="pb-2 font-semibold text-[0.65rem] text-muted-foreground uppercase tracking-widest">
              SYNC
            </h2>
            <AuthRequired
              feature="sync installations"
              isAuthenticated={auth.isAuthenticated}
              onSignIn={() => onNavigate('login')}
            >
              <button className="w-full cursor-pointer rounded-xl border-none bg-primary px-5 py-2.5 font-medium text-[0.85rem] text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90">
                Sync to Platform
              </button>
            </AuthRequired>
          </div>
        </div>

        <div className="flex flex-col">
          <div className="mb-6">
            <h2 className="pb-2 font-semibold text-[0.65rem] text-muted-foreground uppercase tracking-widest">
              AGENT OVERVIEW
            </h2>
            <div className="rounded-2xl border border-border bg-card py-1">
              {agentsLoading && agents.length === 0 ? (
                <div className="flex items-center justify-between gap-3 px-5 py-4">
                  <span className="text-[0.825rem] text-muted-foreground">Scanning...</span>
                </div>
              ) : agents.length === 0 ? (
                <div className="flex items-center justify-between gap-3 px-5 py-4">
                  <span className="text-[0.825rem] text-muted-foreground">No agents detected</span>
                </div>
              ) : (
                agents.map((agent: { id: string; name: string; paths: string[] }) => {
                  const dotColour = getAgentDotColour(agent.id)
                  const hasConfig = agent.paths.length > 0

                  return (
                    <div key={agent.id} className="flex items-center gap-2.5 px-5 py-3">
                      <div
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: dotColour, boxShadow: `0 0 6px ${dotColour}66` }}
                      />
                      <div className="flex flex-1 items-center justify-between gap-2">
                        <span className="font-medium text-[0.85rem] text-foreground">
                          {agent.name}
                        </span>
                        <span
                          className={cn(
                            'font-medium text-xs',
                            hasConfig ? 'text-green-500' : 'text-yellow-500'
                          )}
                        >
                          {hasConfig ? 'Configured' : 'Not configured'}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
