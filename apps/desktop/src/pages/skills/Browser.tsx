import { installResultSchema } from '@agentver/shared'
import { cn } from '@agentver/ui-utils'
import { useState } from 'react'
import type { TypeFilter } from '../../hooks/useSearch'
import { useSearch } from '../../hooks/useSearch'
import { runCLI } from '../../lib/cli-bridge'
import { CreateSkill, PlusIcon } from '../CreateSkill'

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'skill', label: 'Skill' },
  { value: 'config', label: 'Config' },
  { value: 'plugin', label: 'Plugin' },
  { value: 'script', label: 'Script' },
  { value: 'prompt', label: 'Prompt' },
]

const TYPE_BADGE_COLOURS: Record<string, string> = {
  skill: '#3b82f6',
  config: '#8b5cf6',
  plugin: '#22c55e',
  script: '#f59e0b',
  prompt: '#ec4899',
}
const SOURCE_BADGE_COLOURS: Record<string, string> = {
  platform: '#3b82f6',
  community: '#22c55e',
  'well-known': '#f59e0b',
}

function getBadgeColour(type: string): string {
  return TYPE_BADGE_COLOURS[type.toLowerCase()] ?? '#666'
}
function getSourceColour(source: string): string {
  return SOURCE_BADGE_COLOURS[source.toLowerCase()] ?? '#666'
}

function SearchIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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

function SkeletonCard() {
  return (
    <div className="flex min-h-[180px] flex-col justify-between gap-4 rounded-2xl border border-border bg-card px-6 py-5">
      <div className="h-4 w-[70%] animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
      <div className="h-3 w-[50%] animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
      <div className="mt-2 h-3.5 w-[90%] animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
      <div className="mt-2 flex gap-1.5">
        <div className="h-[22px] w-12 animate-[pulse_1.5s_ease-in-out_infinite] rounded bg-muted" />
        <div className="h-[22px] w-[60px] animate-[pulse_1.5s_ease-in-out_infinite] rounded bg-muted" />
      </div>
    </div>
  )
}

type SkillResult = { name: string; description: string; type: string; source: string; url?: string }
type InstallStatus = 'idle' | 'installing' | 'installed' | 'error'

function InstallButton({ skill }: { skill: SkillResult }) {
  const [status, setStatus] = useState<InstallStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleInstall() {
    setStatus('installing')
    setError(null)
    const result = await runCLI('install', [skill.url || skill.name], installResultSchema)
    if (result.success) setStatus('installed')
    else {
      setStatus('error')
      setError(result.error?.message ?? 'Installation failed')
    }
  }

  if (status === 'installed')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-green-800 px-3.5 py-1.5 font-medium text-white text-xs">
        &#10003; Installed
      </span>
    )
  if (status === 'error')
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={handleInstall}
          className="shrink-0 cursor-pointer rounded-md border-none bg-destructive px-3.5 py-1.5 font-[inherit] font-medium text-white text-xs transition-colors hover:bg-destructive/90"
        >
          Retry
        </button>
        {error && (
          <span className="max-w-[160px] text-right text-[0.65rem] text-destructive">{error}</span>
        )}
      </div>
    )

  return (
    <button
      onClick={handleInstall}
      disabled={status === 'installing'}
      className={cn(
        'shrink-0 cursor-pointer rounded-md border-none px-3.5 py-1.5 font-[inherit] font-medium text-primary-foreground text-xs transition-colors',
        status === 'installing'
          ? 'cursor-not-allowed bg-muted text-muted-foreground opacity-60'
          : 'bg-primary hover:bg-primary/90'
      )}
    >
      {status === 'installing' ? 'Installing...' : 'Install'}
    </button>
  )
}

function SkillCard({ skill }: { skill: SkillResult }) {
  const badgeColour = getBadgeColour(skill.type)
  const sourceColour = getSourceColour(skill.source)
  const nameParts = skill.name.split('/')
  const hasOrg = nameParts.length > 1
  const orgName = hasOrg ? nameParts[0] : undefined
  const skillName = hasOrg ? nameParts.slice(1).join('/') : skill.name

  return (
    <div className="flex min-h-[180px] flex-col justify-between gap-4 rounded-2xl border border-border bg-card px-6 py-5 transition-colors hover:border-foreground/20">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold text-base text-foreground tracking-tight">{skillName}</h3>
        {orgName && <span className="text-muted-foreground text-xs">{orgName}</span>}
        <p className="mt-1.5 line-clamp-2 text-[0.85rem] text-muted-foreground leading-relaxed">
          {skill.description}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <span
            className="whitespace-nowrap rounded border px-2 py-0.5 font-medium text-[0.7rem] capitalize"
            style={{
              background: `${badgeColour}1a`,
              color: badgeColour,
              borderColor: `${badgeColour}33`,
            }}
          >
            {skill.type}
          </span>
          <span
            className="whitespace-nowrap rounded border px-2 py-0.5 font-medium text-[0.7rem] capitalize"
            style={{
              background: `${sourceColour}1a`,
              color: sourceColour,
              borderColor: `${sourceColour}33`,
            }}
          >
            {skill.source}
          </span>
        </div>
        <InstallButton skill={skill} />
      </div>
    </div>
  )
}

export function Browser() {
  const { query, setQuery, typeFilter, setTypeFilter, results, loading, error, hasSearched } =
    useSearch()
  const [createSkillOpen, setCreateSkillOpen] = useState(false)

  return (
    <div className="mx-auto max-w-[1100px] px-10 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-[family-name:var(--font-display)] font-semibold text-2xl text-foreground tracking-tight">
          Browse Skills
        </h1>
        <button
          onClick={() => setCreateSkillOpen(true)}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border-none bg-primary px-3.5 py-2 font-[inherit] font-medium text-[0.825rem] text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
        >
          <PlusIcon />
          <span>Create Skill</span>
        </button>
      </div>
      <CreateSkill open={createSkillOpen} onClose={() => setCreateSkillOpen(false)} />

      <div className="relative mb-4 flex items-center">
        <div className="pointer-events-none absolute top-1/2 left-3.5 flex -translate-y-1/2 items-center text-muted-foreground">
          <SearchIcon />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills, configs, plugins..."
          className="w-full rounded-xl border border-border bg-card py-3 pr-11 pl-11 font-[inherit] text-[0.95rem] text-foreground outline-none transition-colors focus:border-primary"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute top-1/2 right-3 flex -translate-y-1/2 cursor-pointer items-center justify-center rounded border-none bg-transparent p-1 text-muted-foreground"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        )}
      </div>

      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {TYPE_FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setTypeFilter(filter.value)}
            className={cn(
              'shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3.5 py-1.5 font-[inherit] font-medium text-xs transition-all',
              typeFilter === filter.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-muted text-muted-foreground'
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
          <span className="text-[0.85rem] text-destructive">{error}</span>
          <button
            onClick={() => setQuery(query)}
            className="shrink-0 cursor-pointer rounded-md border border-border bg-muted px-3.5 py-1.5 font-[inherit] font-medium text-foreground text-xs transition-colors hover:bg-accent"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !error && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {!loading && !error && hasSearched && results.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {results.map((skill) => (
            <SkillCard key={`${skill.source}/${skill.name}`} skill={skill} />
          ))}
        </div>
      )}
      {!loading && !error && !hasSearched && (
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-16">
          <div className="mb-2 text-muted-foreground opacity-60">
            <SearchIcon size={48} />
          </div>
          <p className="font-semibold text-foreground text-lg">Search for skills to install</p>
          <p className="text-center text-muted-foreground text-sm">
            Browse the registry for skills, configs, plugins, and more.
          </p>
        </div>
      )}
      {!loading && !error && hasSearched && results.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-16">
          <p className="font-semibold text-foreground text-lg">
            No skills found for &lsquo;{query}&rsquo;
          </p>
          <p className="text-center text-muted-foreground text-sm">
            Try different search terms or adjust the type filter.
          </p>
        </div>
      )}
    </div>
  )
}
