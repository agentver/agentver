import type { PackageSource, StatusResult } from '@agentver/shared'
import { cn } from '@agentver/ui-utils'
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useInstalledSkills } from '../../hooks/useInstalledSkills'
import { useSkillUpdates } from '../../hooks/useSkillUpdates'
import { getAuthData } from '../../lib/auth'
import { formatRelativeTime } from '../../lib/format'

type ViewMode = 'grid' | 'list'

const AGENT_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  'claude-cowork': 'Claude Cowork',
  cursor: 'Cursor',
  copilot: 'GitHub Copilot',
  windsurf: 'Windsurf',
  codex: 'OpenAI Codex',
  'gemini-cli': 'Gemini CLI',
  roo: 'Roo Code',
  goose: 'Goose',
  junie: 'JetBrains Junie',
  aider: 'Aider',
  cline: 'Cline',
  amp: 'Amp',
  trae: 'Trae',
  continue: 'Continue',
  'kiro-cli': 'Kiro CLI',
  augment: 'Augment',
  opencode: 'OpenCode',
  openhands: 'OpenHands',
  kode: 'Kode',
  'qwen-code': 'Qwen Code',
  replit: 'Replit',
}
const AGENT_COLOURS: Record<string, string> = {
  'claude-code': '#a855f7',
  'claude-cowork': '#a855f7',
  cursor: '#3b82f6',
  copilot: '#22c55e',
  windsurf: '#14b8a6',
}

function getAgentColour(agentId: string): string {
  return AGENT_COLOURS[agentId] ?? '#666'
}
function getAgentDisplayName(agentId: string): string {
  return AGENT_NAMES[agentId] ?? agentId
}
function formatSource(source: PackageSource): string {
  if (source.type === 'git') {
    const uri = source.uri
    const shortened = uri.replace(/^https?:\/\//, '').replace(/\.git$/, '')
    return shortened.length > 45 ? `${shortened.substring(0, 42)}...` : shortened
  }
  return source.hostname
}

type SkillStatusInfo = { label: string; colour: string; hasUpdate: boolean }

function getSkillStatusInfo(
  name: string,
  modified: boolean,
  status: StatusResult | null
): SkillStatusInfo {
  if (!status) return { label: '', colour: 'transparent', hasUpdate: false }
  const pkg = status.packages.find((p) => p.name === name)
  if (!pkg) return { label: '', colour: 'transparent', hasUpdate: false }
  const isModified = modified || pkg.modified
  const hasUpstream = pkg.upstream
  if (isModified && hasUpstream)
    return { label: 'Modified + update available', colour: '#f97316', hasUpdate: true }
  if (hasUpstream)
    return { label: 'Update available', colour: 'var(--color-primary)', hasUpdate: true }
  if (isModified) return { label: 'Modified locally', colour: '#eab308', hasUpdate: false }
  return { label: 'Up to date', colour: '#22c55e', hasUpdate: false }
}

type RemoveTarget = { name: string; paths: string[] }

function RefreshIcon() {
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
      <path d="M1.5 8a6.5 6.5 0 0111.48-4.16" />
      <path d="M14.5 8a6.5 6.5 0 01-11.48 4.16" />
      <path d="M13 1v3.5h-3.5" />
      <path d="M3 15v-3.5h3.5" />
    </svg>
  )
}
function GridIcon() {
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
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </svg>
  )
}
function ListViewIcon() {
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
      <path d="M1.5 4h13M1.5 8h13M1.5 12h13" />
    </svg>
  )
}
function UpdateIcon() {
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
      <path d="M8 13V3M4 7l4-4 4 4" />
    </svg>
  )
}
function SyncIcon() {
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
      <path d="M2 8a6 6 0 019.5-4.87" />
      <path d="M14 8a6 6 0 01-9.5 4.87" />
      <path d="M11 1v3h3" />
      <path d="M5 12v3H2" />
    </svg>
  )
}

function StatusBadge({ label, colour }: { label: string; colour: string }) {
  if (!label) return null
  return (
    <span
      className="inline-flex items-center gap-1.5 font-medium text-[0.7rem]"
      style={{ color: colour }}
    >
      <span
        className="size-[7px] shrink-0 rounded-full"
        style={{ background: colour, boxShadow: `0 0 6px ${colour}66` }}
      />
      {label}
    </span>
  )
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-6 py-5">
      <div className="h-4 w-[70%] animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
      <div className="h-3 w-[50%] animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
      <div className="mt-3 h-3.5 w-[35%] animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
    </div>
  )
}

function SkillCard({
  name,
  source,
  agents,
  installedAt,
  modified,
  onRemove,
  removing,
  statusInfo,
  onUpdate,
  updating,
}: {
  name: string
  source: PackageSource
  agents: string[]
  installedAt: string
  modified: boolean
  onRemove: () => void
  removing: boolean
  statusInfo: SkillStatusInfo
  onUpdate: () => void
  updating: boolean
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-6 py-5 transition-colors">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-[1.05rem] text-foreground tracking-tight">{name}</h3>
          {modified && !statusInfo.label && (
            <div
              className="size-2 shrink-0 rounded-full bg-yellow-500"
              style={{ boxShadow: '0 0 6px #eab30866' }}
              title="Modified locally"
            />
          )}
        </div>
        <span
          className="truncate font-mono text-muted-foreground text-xs"
          title={source.type === 'git' ? source.uri : source.baseUrl}
        >
          {formatSource(source)}
        </span>
      </div>
      {statusInfo.label && (
        <div className="flex items-center justify-between gap-2">
          <StatusBadge label={statusInfo.label} colour={statusInfo.colour} />
          {statusInfo.hasUpdate && (
            <button
              onClick={onUpdate}
              disabled={updating}
              className={cn(
                'cursor-pointer rounded-md border-none px-2.5 py-1 font-[inherit] font-medium text-[0.725rem] text-primary-foreground transition-all',
                updating
                  ? 'cursor-not-allowed bg-muted text-muted-foreground opacity-60'
                  : 'bg-primary hover:bg-primary/90'
              )}
            >
              {updating ? 'Updating...' : 'Update'}
            </button>
          )}
        </div>
      )}
      {agents.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {agents.map((agentId) => (
            <span
              key={agentId}
              className="whitespace-nowrap rounded-md bg-accent px-2 py-0.5 font-medium text-[0.725rem] text-foreground"
              style={{ borderLeft: `3px solid ${getAgentColour(agentId)}` }}
            >
              {getAgentDisplayName(agentId)}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center">
        <span className="text-[0.775rem] text-muted-foreground">
          Installed {formatRelativeTime(installedAt)}
        </span>
      </div>
      <div className="flex items-center justify-between border-border border-t pt-2.5">
        <button
          onClick={() => {
            const path = source.type === 'git' ? source.uri : source.baseUrl
            navigator.clipboard.writeText(path)
          }}
          className="cursor-pointer rounded-md border-none bg-transparent px-3 py-1.5 font-[inherit] font-medium text-muted-foreground text-xs transition-colors hover:text-foreground"
        >
          Open in file manager
        </button>
        <button
          onClick={onRemove}
          disabled={removing}
          className={cn(
            'cursor-pointer rounded-md border-none px-3 py-1.5 font-[inherit] font-medium text-xs transition-colors',
            removing
              ? 'cursor-not-allowed bg-transparent text-destructive opacity-50'
              : 'bg-transparent text-destructive hover:bg-destructive hover:text-white'
          )}
        >
          {removing ? 'Removing...' : 'Remove'}
        </button>
      </div>
    </div>
  )
}

function SkillRow({
  name,
  source,
  agents,
  installedAt,
  modified,
  onRemove,
  removing,
  statusInfo,
  onUpdate,
  updating,
}: {
  name: string
  source: PackageSource
  agents: string[]
  installedAt: string
  modified: boolean
  onRemove: () => void
  removing: boolean
  statusInfo: SkillStatusInfo
  onUpdate: () => void
  updating: boolean
}) {
  return (
    <div className="flex items-center gap-4 border-border border-b bg-card px-5 py-3 transition-colors">
      <div className="flex min-w-0 flex-[2] items-center gap-2">
        <span className="truncate font-semibold text-foreground text-sm">{name}</span>
        {statusInfo.label ? (
          <StatusBadge label={statusInfo.label} colour={statusInfo.colour} />
        ) : (
          modified && (
            <div
              className="size-2 shrink-0 rounded-full bg-yellow-500"
              style={{ boxShadow: '0 0 6px #eab30866' }}
              title="Modified locally"
            />
          )
        )}
      </div>
      <span
        className="flex-[2] truncate font-mono text-muted-foreground text-xs"
        title={source.type === 'git' ? source.uri : source.baseUrl}
      >
        {formatSource(source)}
      </span>
      <div className="flex flex-[2] flex-wrap gap-1">
        {agents.map((agentId) => (
          <span
            key={agentId}
            className="whitespace-nowrap rounded-md bg-accent px-2 py-0.5 font-medium text-[0.7rem] text-foreground"
            style={{ borderLeft: `3px solid ${getAgentColour(agentId)}` }}
          >
            {getAgentDisplayName(agentId)}
          </span>
        ))}
      </div>
      <span className="flex-1 whitespace-nowrap text-muted-foreground text-xs">
        {formatRelativeTime(installedAt)}
      </span>
      <div className="flex w-[120px] shrink-0 items-center justify-end gap-1.5">
        {statusInfo.hasUpdate && (
          <button
            onClick={onUpdate}
            disabled={updating}
            className={cn(
              'cursor-pointer rounded-md border-none px-2.5 py-1 font-[inherit] font-medium text-[0.7rem] text-primary-foreground transition-all',
              updating
                ? 'cursor-not-allowed bg-muted text-muted-foreground opacity-60'
                : 'bg-primary hover:bg-primary/90'
            )}
          >
            {updating ? '...' : 'Update'}
          </button>
        )}
        <button
          onClick={onRemove}
          disabled={removing}
          className={cn(
            'cursor-pointer rounded-md border-none px-3 py-1 font-[inherit] font-medium text-xs transition-colors',
            removing
              ? 'cursor-not-allowed bg-transparent text-destructive opacity-50'
              : 'bg-transparent text-destructive hover:bg-destructive hover:text-white'
          )}
        >
          Remove
        </button>
      </div>
    </div>
  )
}

export function Installed() {
  const { skills, loading, error, removing, refresh, removeSkill } = useInstalledSkills()
  const {
    status,
    statusLoading,
    statusError,
    checkStatus,
    updating,
    updateAll,
    updateSkill,
    syncing,
    sync,
  } = useSkillUpdates()
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    async function checkAuth() {
      try {
        const auth = await getAuthData()
        setIsAuthenticated(Boolean(auth?.token || auth?.apiKey))
      } catch {
        /* Auth not available */
      }
    }
    checkAuth()
  }, [])
  const handleRemoveConfirm = async () => {
    if (!removeTarget) return
    await removeSkill(removeTarget.name)
    setRemoveTarget(null)
  }
  const skillCount = skills.length
  const subtitle = skillCount === 1 ? '1 skill installed' : `${skillCount} skills installed`
  const hasUpdates = (status?.summary.upstream ?? 0) > 0
  const statusParts: string[] = []
  if (status) {
    if (status.summary.upToDate > 0) statusParts.push(`${status.summary.upToDate} up to date`)
    if (status.summary.upstream > 0)
      statusParts.push(
        `${status.summary.upstream} ha${status.summary.upstream === 1 ? 's' : 've'} updates`
      )
    if (status.summary.modified > 0) statusParts.push(`${status.summary.modified} modified`)
    if (status.summary.unknown > 0) statusParts.push(`${status.summary.unknown} unknown`)
  }

  return (
    <div className="mx-auto max-w-[1100px] px-10 py-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="mb-1 font-[family-name:var(--font-display)] font-semibold text-2xl text-foreground tracking-tight">
            Installed Skills
          </h1>
          <p className="text-muted-foreground text-sm">
            {loading && skillCount === 0 ? 'Loading...' : subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'flex cursor-pointer items-center justify-center border-none px-2.5 py-2 font-[inherit] transition-colors',
                viewMode === 'grid'
                  ? 'bg-accent text-foreground'
                  : 'bg-transparent text-muted-foreground hover:bg-muted'
              )}
              title="Grid view"
            >
              <GridIcon />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'flex cursor-pointer items-center justify-center border-none px-2.5 py-2 font-[inherit] transition-colors',
                viewMode === 'list'
                  ? 'bg-accent text-foreground'
                  : 'bg-transparent text-muted-foreground hover:bg-muted'
              )}
              title="List view"
            >
              <ListViewIcon />
            </button>
          </div>
          <button
            onClick={checkStatus}
            disabled={statusLoading}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors',
              statusLoading ? 'cursor-not-allowed opacity-50' : 'bg-muted hover:bg-accent'
            )}
            title="Check for updates"
          >
            <span className="flex items-center">
              <UpdateIcon />
            </span>
            <span>{statusLoading ? 'Checking...' : 'Check for Updates'}</span>
          </button>
          {hasUpdates && (
            <button
              onClick={() => updateAll()}
              disabled={updating}
              className={cn(
                'flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border-none px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-primary-foreground transition-colors',
                updating
                  ? 'cursor-not-allowed bg-muted text-muted-foreground opacity-60'
                  : 'bg-primary hover:bg-primary/90'
              )}
            >
              <span className="flex items-center">
                <UpdateIcon />
              </span>
              <span>{updating ? 'Updating...' : 'Update All'}</span>
            </button>
          )}
          {isAuthenticated && (
            <button
              onClick={() => sync()}
              disabled={syncing}
              className={cn(
                'flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors',
                syncing ? 'cursor-not-allowed opacity-50' : 'bg-muted hover:bg-accent'
              )}
              title="Sync to platform"
            >
              <span
                className={cn('flex items-center', syncing && 'animate-[spin_1s_linear_infinite]')}
              >
                <SyncIcon />
              </span>
              <span>{syncing ? 'Syncing...' : 'Sync'}</span>
            </button>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors',
              loading ? 'cursor-not-allowed opacity-50' : 'bg-muted hover:bg-accent'
            )}
          >
            <span
              className={cn('flex items-center', loading && 'animate-[spin_1s_linear_infinite]')}
            >
              <RefreshIcon />
            </span>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {status && statusParts.length > 0 && (
        <div className="mb-5 rounded-xl border border-border bg-card px-4 py-2.5">
          <span className="text-[0.825rem] text-muted-foreground">{statusParts.join(', ')}</span>
        </div>
      )}
      {(error || statusError) && (
        <div className="mb-6 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-[0.85rem] text-destructive">
          {error || statusError}
        </div>
      )}
      {loading && skillCount === 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {!loading && skillCount === 0 && !error && (
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-16">
          <div className="mb-2 opacity-60">
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted-foreground"
            >
              <rect x="8" y="12" width="32" height="24" rx="3" />
              <path d="M16 12V9a3 3 0 013-3h10a3 3 0 013 3v3" />
              <path d="M24 22v8M20 26h8" />
            </svg>
          </div>
          <p className="font-semibold text-foreground text-lg">No skills installed yet</p>
          <p className="text-muted-foreground text-sm">Browse skills to find something useful</p>
        </div>
      )}
      {skillCount > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {skills.map((skill) => {
            const statusInfo = getSkillStatusInfo(skill.name, skill.modified, status)
            return (
              <SkillCard
                key={skill.name}
                name={skill.name}
                source={skill.source}
                agents={skill.agents}
                installedAt={skill.installedAt}
                modified={skill.modified}
                removing={removing}
                statusInfo={statusInfo}
                updating={updating}
                onUpdate={() => updateSkill(skill.name)}
                onRemove={() =>
                  setRemoveTarget({
                    name: skill.name,
                    paths:
                      skill.source.type === 'git' ? [skill.source.path] : [skill.source.baseUrl],
                  })
                }
              />
            )
          })}
        </div>
      )}
      {skillCount > 0 && viewMode === 'list' && (
        <div className="flex flex-col overflow-hidden rounded-2xl border border-border">
          <div className="flex items-center gap-4 border-border border-b bg-muted px-5 py-2.5">
            <span className="flex-[2] font-semibold text-[0.7rem] text-muted-foreground uppercase tracking-wider">
              Name
            </span>
            <span className="flex-[2] font-semibold text-[0.7rem] text-muted-foreground uppercase tracking-wider">
              Source
            </span>
            <span className="flex-[2] font-semibold text-[0.7rem] text-muted-foreground uppercase tracking-wider">
              Agents
            </span>
            <span className="flex-1 font-semibold text-[0.7rem] text-muted-foreground uppercase tracking-wider">
              Installed
            </span>
            <span className="w-[120px] shrink-0 font-semibold text-[0.7rem] text-muted-foreground uppercase tracking-wider">
              Actions
            </span>
          </div>
          {skills.map((skill) => {
            const statusInfo = getSkillStatusInfo(skill.name, skill.modified, status)
            return (
              <SkillRow
                key={skill.name}
                name={skill.name}
                source={skill.source}
                agents={skill.agents}
                installedAt={skill.installedAt}
                modified={skill.modified}
                removing={removing}
                statusInfo={statusInfo}
                updating={updating}
                onUpdate={() => updateSkill(skill.name)}
                onRemove={() =>
                  setRemoveTarget({
                    name: skill.name,
                    paths:
                      skill.source.type === 'git' ? [skill.source.path] : [skill.source.baseUrl],
                  })
                }
              />
            )
          })}
        </div>
      )}
      <ConfirmDialog
        open={removeTarget !== null}
        title={`Remove ${removeTarget?.name ?? ''}?`}
        message={`This will delete files from: ${removeTarget?.paths.join(', ') ?? ''}`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        danger
        onConfirm={handleRemoveConfirm}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  )
}
