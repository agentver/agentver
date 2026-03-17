import { cn } from '@agentver/ui-utils'
import { useCallback, useEffect, useState } from 'react'
import { useProject } from '../context/ProjectContext'
import { useAgents } from '../hooks/useAgents'
import { useSettings } from '../hooks/useSettings'
import { useSkillUpdates } from '../hooks/useSkillUpdates'
import { getAuthData } from '../lib/auth'
import { getCLIVersion } from '../lib/cli-bridge'
import type { AuthProps, Page } from '../types'

type SettingsProps = {
  auth: AuthProps
  onNavigate: (page: Page) => void
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="pb-2 font-semibold text-[0.65rem] text-muted-foreground uppercase tracking-widest">
      {children}
    </h2>
  )
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium text-foreground text-sm">{label}</span>
        {description && (
          <span className="truncate text-muted-foreground text-xs">{description}</span>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[22px] w-10 cursor-pointer rounded-full border-none p-0 transition-colors',
        checked ? 'bg-primary' : 'bg-muted-foreground/30'
      )}
    >
      <div
        className={cn(
          'absolute top-0.5 size-[18px] rounded-full bg-white transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 font-[inherit] font-medium text-[0.8rem] text-foreground transition-colors"
      >
        <span>{selectedLabel}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setOpen(false)} />
          <div className="absolute top-[calc(100%+4px)] right-0 z-[100] min-w-[120px] rounded-lg border border-border bg-card p-1 shadow-lg">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={cn(
                  'block w-full cursor-pointer rounded-md border-none px-3 py-1.5 text-left font-[inherit] font-medium text-[0.8rem] transition-colors',
                  option.value === value
                    ? 'bg-accent text-primary'
                    : 'bg-transparent text-foreground hover:bg-muted'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function Settings({ auth, onNavigate }: SettingsProps) {
  const { settings, updateTheme, updateDefaultScope, updateAuditEnabled, updateBlockSeverity } =
    useSettings()
  const [platformUrl, setPlatformUrl] = useState<string | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [cliVersion, setCLIVersion] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)

  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'checking' | 'available' | 'up-to-date' | 'error'
  >('idle')

  const { syncing, syncResult, sync } = useSkillUpdates()
  const { activeProject } = useProject()
  const { agents } = useAgents()

  useEffect(() => {
    async function loadSettings() {
      try {
        const authData = await getAuthData()
        if (authData?.token || authData?.apiKey) {
          setIsAuthenticated(true)
          setPlatformUrl(authData.platformUrl ?? null)
        }
      } catch {
        /* Auth not available */
      }
      try {
        const version = await getCLIVersion()
        setCLIVersion(version)
      } catch {
        setCLIVersion(null)
      }
      try {
        const { getVersion } = await import('@tauri-apps/api/app')
        const version = await getVersion()
        setAppVersion(version)
      } catch {
        setAppVersion('0.1.0')
      }
    }
    loadSettings()
  }, [])

  useEffect(() => {
    setIsAuthenticated(auth.isAuthenticated)
    setPlatformUrl(auth.platformUrl)
  }, [auth.isAuthenticated, auth.platformUrl])

  const handleSync = useCallback(async () => {
    await sync()
  }, [sync])

  async function handleCheckForUpdates() {
    setUpdateStatus('checking')
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      setUpdateStatus(update ? 'available' : 'up-to-date')
    } catch {
      // Updater may not be configured yet
      setUpdateStatus('up-to-date')
    }
  }

  return (
    <div className="mx-auto max-w-[720px] px-10 py-8">
      <div className="mb-8">
        <h1 className="mb-1 font-[family-name:var(--font-display)] font-semibold text-2xl text-foreground tracking-tight">
          Settings
        </h1>
        <p className="text-muted-foreground text-sm">Configure your Agentver desktop experience</p>
      </div>

      <div className="mb-6">
        <SectionTitle>ACCOUNT</SectionTitle>
        <div className="rounded-2xl border border-border bg-card py-1">
          {isAuthenticated ? (
            <>
              <SettingRow
                label="Signed in"
                description={auth.user ? auth.user.email : 'Authenticated via API key'}
              >
                <button
                  onClick={() => {
                    auth.signOut()
                    setIsAuthenticated(false)
                    setPlatformUrl(null)
                  }}
                  className="cursor-pointer rounded-lg border border-border bg-muted px-3.5 py-1.5 font-medium text-destructive text-xs transition-colors hover:bg-destructive hover:text-white"
                >
                  Sign Out
                </button>
              </SettingRow>
              <div className="mx-5 h-px bg-border" />
              <SettingRow label="Connected platform" description="Your platform instance URL">
                <span className="font-mono text-muted-foreground text-xs">
                  {platformUrl ?? 'Not connected'}
                </span>
              </SettingRow>
            </>
          ) : (
            <SettingRow
              label="Not signed in"
              description="Sign in to sync skills and access team features"
            >
              <button
                onClick={() => onNavigate('login')}
                className="cursor-pointer rounded-lg border-none bg-primary px-3.5 py-1.5 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
              >
                Sign In
              </button>
            </SettingRow>
          )}
        </div>
      </div>

      <div className="mb-6">
        <SectionTitle>REPOSITORY</SectionTitle>
        <div className="rounded-2xl border border-border bg-card py-1">
          <SettingRow
            label="Connected repository"
            description={activeProject ? 'Skills repository path' : 'No repository connected'}
          >
            <span className="font-mono text-muted-foreground text-xs">
              {activeProject ?? 'None'}
            </span>
          </SettingRow>
        </div>
      </div>

      <div className="mb-6">
        <SectionTitle>AGENTS</SectionTitle>
        <div className="rounded-2xl border border-border bg-card py-1">
          {agents.length === 0 ? (
            <SettingRow
              label="No agents detected"
              description="Install a supported coding agent to get started"
            >
              <span className="font-mono text-muted-foreground text-xs">&mdash;</span>
            </SettingRow>
          ) : (
            agents.map((agent: { id: string; name: string; paths: string[] }, index: number) => (
              <div key={agent.id}>
                {index > 0 && <div className="mx-5 h-px bg-border" />}
                <SettingRow
                  label={agent.name}
                  description={agent.paths.length > 0 ? agent.paths[0] : 'No config path'}
                >
                  <span
                    className={cn(
                      'font-medium text-xs',
                      agent.paths.length > 0 ? 'text-green-500' : 'text-yellow-500'
                    )}
                  >
                    {agent.paths.length > 0 ? 'Configured' : 'Not configured'}
                  </span>
                </SettingRow>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mb-6">
        <SectionTitle>APPEARANCE</SectionTitle>
        <div className="rounded-2xl border border-border bg-card py-1">
          <SettingRow label="Theme" description="Choose your preferred appearance">
            <Select
              value={settings.theme}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              onChange={updateTheme}
            />
          </SettingRow>
          <div className="mx-5 h-px bg-border" />
          <SettingRow label="Default scope" description="Where new skills are installed by default">
            <Select
              value={settings.defaultScope}
              options={[
                { value: 'project', label: 'Project' },
                { value: 'global', label: 'Global' },
              ]}
              onChange={updateDefaultScope}
            />
          </SettingRow>
        </div>
      </div>

      {isAuthenticated && (
        <div className="mb-6">
          <SectionTitle>PLATFORM</SectionTitle>
          <div className="rounded-2xl border border-border bg-card py-1">
            <SettingRow
              label="Sync to platform"
              description={
                syncResult
                  ? `Last sync: ${syncResult.synced} package${syncResult.synced === 1 ? '' : 's'} synced`
                  : 'Push your local state to the platform'
              }
            >
              <button
                onClick={handleSync}
                disabled={syncing}
                className={cn(
                  'cursor-pointer rounded-lg border-none px-3.5 py-1.5 font-medium text-primary-foreground text-xs transition-colors',
                  syncing
                    ? 'cursor-not-allowed bg-muted text-muted-foreground opacity-60'
                    : 'bg-primary hover:bg-primary/90'
                )}
              >
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </SettingRow>
          </div>
        </div>
      )}

      <div className="mb-6">
        <SectionTitle>SECURITY</SectionTitle>
        <div className="rounded-2xl border border-border bg-card py-1">
          <SettingRow
            label="Audit on install"
            description="Run security audit when installing skills"
          >
            <Toggle checked={settings.auditEnabled} onChange={updateAuditEnabled} />
          </SettingRow>
          <div className="mx-5 h-px bg-border" />
          <SettingRow
            label="Block severity"
            description="Block installation of skills with findings at or above this severity"
          >
            <Select
              value={settings.blockSeverity}
              options={[
                { value: 'critical', label: 'Critical' },
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
              ]}
              onChange={updateBlockSeverity}
            />
          </SettingRow>
        </div>
      </div>

      <div className="mb-6">
        <SectionTitle>ABOUT</SectionTitle>
        <div className="rounded-2xl border border-border bg-card py-1">
          <SettingRow label="App version">
            <span className="font-mono text-muted-foreground text-xs">
              {appVersion ?? 'Loading...'}
            </span>
          </SettingRow>
          <div className="mx-5 h-px bg-border" />
          <SettingRow label="CLI version">
            <span className="font-mono text-muted-foreground text-xs">
              {cliVersion ?? 'Not detected'}
            </span>
          </SettingRow>
          <div className="mx-5 h-px bg-border" />
          <SettingRow
            label="Updates"
            description={
              updateStatus === 'available'
                ? 'Update available — a new version is ready'
                : updateStatus === 'up-to-date'
                  ? 'Up to date'
                  : updateStatus === 'error'
                    ? 'Failed to check for updates'
                    : 'Check for new versions of the desktop app'
            }
          >
            <button
              onClick={handleCheckForUpdates}
              disabled={updateStatus === 'checking'}
              className={cn(
                'cursor-pointer rounded-lg border border-border bg-muted px-3.5 py-1.5 font-medium text-foreground text-xs transition-colors hover:bg-accent',
                updateStatus === 'checking' && 'cursor-not-allowed opacity-60'
              )}
            >
              {updateStatus === 'checking'
                ? 'Checking...'
                : updateStatus === 'available'
                  ? 'Update available'
                  : updateStatus === 'up-to-date'
                    ? 'Up to date'
                    : 'Check for updates'}
            </button>
          </SettingRow>
        </div>
      </div>
    </div>
  )
}
