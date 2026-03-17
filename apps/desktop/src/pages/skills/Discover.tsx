import { cn } from '@agentver/ui-utils'
import { useState } from 'react'
import { useAdoptSkills, useScanAgents } from '../../hooks/useCLI'

type AdoptStatus = 'idle' | 'adopting' | 'adopted' | 'error'
type DiscoveredItem = {
  name: string
  path: string
  type: string
  adoptStatus: AdoptStatus
  adoptError: string | null
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

function ScanIcon({ size = 18 }: { size?: number }) {
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
      <circle cx="9" cy="9" r="7" />
      <path d="M9 2v3M9 13v3M2 9h3M13 9h3" />
      <circle cx="9" cy="9" r="3" />
    </svg>
  )
}

function TypeBadge({ type }: { type: string }) {
  const isSkill = type.toLowerCase() === 'skill'
  const colour = isSkill ? '#3b82f6' : '#8b5cf6'
  const label = isSkill ? 'SKILL' : 'AGENT_CONFIG'
  return (
    <span
      className="whitespace-nowrap rounded border px-2 py-0.5 font-semibold text-[0.65rem] tracking-wider"
      style={{ background: `${colour}1a`, color: colour, borderColor: `${colour}33` }}
    >
      {label}
    </span>
  )
}

function AgentBadge({ agentId }: { agentId: string }) {
  const colour = getAgentColour(agentId)
  return (
    <span
      className="whitespace-nowrap rounded-md bg-accent px-2 py-0.5 font-medium text-[0.7rem] text-foreground"
      style={{ borderLeft: `3px solid ${colour}` }}
    >
      {agentId}
    </span>
  )
}

function DiscoverCard({
  item,
  agents,
  onAdopt,
}: {
  item: DiscoveredItem
  agents: string[]
  onAdopt: () => void
}) {
  const isAdopted = item.adoptStatus === 'adopted'
  const isAdopting = item.adoptStatus === 'adopting'

  return (
    <div className="flex min-h-[140px] flex-col justify-between gap-4 rounded-2xl border border-border bg-card px-6 py-5 transition-colors hover:border-foreground/20">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-base text-foreground tracking-tight">{item.name}</h3>
          <TypeBadge type={item.type} />
        </div>
        <span className="truncate font-mono text-muted-foreground text-xs">{item.path}</span>
        {agents.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {agents.map((agentId) => (
              <AgentBadge key={agentId} agentId={agentId} />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        {isAdopted ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-green-500 text-xs">
            &#10003; Already managed
          </span>
        ) : (
          <button
            onClick={onAdopt}
            disabled={isAdopting}
            className={cn(
              'shrink-0 cursor-pointer rounded-md border-none px-3.5 py-1.5 font-[inherit] font-medium text-primary-foreground text-xs transition-colors',
              isAdopting
                ? 'cursor-not-allowed bg-muted text-muted-foreground opacity-60'
                : 'bg-primary hover:bg-primary/90'
            )}
          >
            {isAdopting ? 'Adopting...' : 'Adopt'}
          </button>
        )}
        {item.adoptStatus === 'error' && item.adoptError && (
          <span className="text-destructive text-xs">{item.adoptError}</span>
        )}
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="flex min-h-[140px] flex-col justify-between gap-4 rounded-2xl border border-border bg-card px-6 py-5">
      <div className="h-4 w-[70%] animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
      <div className="h-3 w-[80%] animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
      <div className="mt-3 h-3.5 w-[40%] animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
    </div>
  )
}

export function Discover() {
  const scan = useScanAgents()
  const adopt = useAdoptSkills()
  const [items, setItems] = useState<DiscoveredItem[]>([])
  const [agentMap, setAgentMap] = useState<Record<string, string[]>>({})
  const [hasScanned, setHasScanned] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  async function handleScan() {
    setSuccessMessage(null)
    const result = await scan.execute(['--global'])
    if (result.success && result.data) {
      const agentLookup: Record<string, string[]> = {}
      for (const agent of result.data.agents) {
        for (const agentPath of agent.paths) {
          agentLookup[agentPath] = agentLookup[agentPath] ?? []
          agentLookup[agentPath]?.push(agent.id)
        }
      }
      setAgentMap(agentLookup)
      setItems(
        result.data.skills.map((skill) => ({
          name: skill.name,
          path: skill.path,
          type: skill.type,
          adoptStatus: 'idle' as AdoptStatus,
          adoptError: null,
        }))
      )
      setHasScanned(true)
    }
  }

  async function handleAdoptSingle(name: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.name === name
          ? { ...item, adoptStatus: 'adopting' as AdoptStatus, adoptError: null }
          : item
      )
    )
    const result = await adopt.execute(['--name', name, '--global'])
    if (result.success && result.data) {
      const adoptedNames = new Set(result.data.adopted.map((a) => a.name))
      setItems((prev) =>
        prev.map((item) => {
          if (item.name === name) {
            if (adoptedNames.has(name)) return { ...item, adoptStatus: 'adopted' as AdoptStatus }
            const skipped = result.data?.skipped.find((s) => s.name === name)
            if (skipped)
              return { ...item, adoptStatus: 'error' as AdoptStatus, adoptError: skipped.reason }
            return { ...item, adoptStatus: 'adopted' as AdoptStatus }
          }
          return item
        })
      )
      if (result.data.adopted.length > 0) {
        setSuccessMessage(
          `Adopted ${result.data.adopted.length} skill${result.data.adopted.length !== 1 ? 's' : ''}`
        )
        setTimeout(() => setSuccessMessage(null), 4000)
      }
    } else {
      setItems((prev) =>
        prev.map((item) =>
          item.name === name
            ? { ...item, adoptStatus: 'error' as AdoptStatus, adoptError: 'Adoption failed' }
            : item
        )
      )
    }
  }

  async function handleAdoptAll() {
    setItems((prev) =>
      prev.map(
        (item): DiscoveredItem =>
          item.adoptStatus === 'adopted'
            ? item
            : { ...item, adoptStatus: 'adopting', adoptError: null }
      )
    )
    const result = await adopt.execute(['--global'])
    if (result.success && result.data) {
      const adoptedNames = new Set(result.data.adopted.map((a) => a.name))
      const skippedMap = new Map(result.data.skipped.map((s) => [s.name, s.reason]))
      setItems((prev) =>
        prev.map((item) => {
          if (item.adoptStatus === 'adopted') return item
          if (adoptedNames.has(item.name)) return { ...item, adoptStatus: 'adopted' as AdoptStatus }
          const reason = skippedMap.get(item.name)
          if (reason) return { ...item, adoptStatus: 'error' as AdoptStatus, adoptError: reason }
          return { ...item, adoptStatus: 'adopted' as AdoptStatus }
        })
      )
      if (result.data.adopted.length > 0) {
        setSuccessMessage(
          `Adopted ${result.data.adopted.length} skill${result.data.adopted.length !== 1 ? 's' : ''}`
        )
        setTimeout(() => setSuccessMessage(null), 4000)
      }
    } else {
      setItems((prev) =>
        prev.map((item) =>
          item.adoptStatus === 'adopting'
            ? { ...item, adoptStatus: 'error' as AdoptStatus, adoptError: 'Adoption failed' }
            : item
        )
      )
    }
  }

  const skillItems = items.filter((item) => item.type.toLowerCase() === 'skill')
  const configItems = items.filter((item) => item.type.toLowerCase() !== 'skill')
  const unadoptedCount = items.filter((item) => item.adoptStatus !== 'adopted').length
  function getAgentsForItem(item: DiscoveredItem): string[] {
    return agentMap[item.path] ?? []
  }

  return (
    <div className="mx-auto max-w-[1100px] px-10 py-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="mb-1 font-[family-name:var(--font-display)] font-semibold text-2xl text-foreground tracking-tight">
            Discovered Skills
          </h1>
          <p className="text-muted-foreground text-sm">Skills and configs found on your system</p>
        </div>
        <div className="flex items-center gap-2">
          {hasScanned && unadoptedCount > 0 && (
            <button
              onClick={handleAdoptAll}
              disabled={adopt.loading}
              className={cn(
                'flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border-none px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-primary-foreground transition-colors',
                adopt.loading
                  ? 'cursor-not-allowed bg-muted text-muted-foreground opacity-60'
                  : 'bg-primary hover:bg-primary/90'
              )}
            >
              {adopt.loading ? 'Adopting...' : 'Adopt All'}
            </button>
          )}
          <button
            onClick={handleScan}
            disabled={scan.loading}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors',
              scan.loading ? 'cursor-not-allowed opacity-50' : 'bg-muted hover:bg-accent'
            )}
          >
            <span
              className={cn(
                'flex items-center',
                scan.loading && 'animate-[spin_1s_linear_infinite]'
              )}
            >
              <ScanIcon />
            </span>
            <span>{scan.loading ? 'Scanning...' : 'Scan System'}</span>
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-green-500/20 bg-green-500/5 px-4 py-3 font-medium text-[0.85rem] text-green-500">
          &#10003; {successMessage}
        </div>
      )}
      {scan.error && (
        <div className="mb-6 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-[0.85rem] text-destructive">
          {scan.error}
        </div>
      )}

      {!hasScanned && !scan.loading && (
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-16">
          <div className="mb-2 text-muted-foreground opacity-60">
            <ScanIcon size={48} />
          </div>
          <p className="font-semibold text-foreground text-lg">
            Scan your system to discover skills
          </p>
          <p className="text-center text-muted-foreground text-sm">
            Find SKILL.md, CLAUDE.md, .cursorrules, AGENTS.md and other agent configs on your
            machine.
          </p>
        </div>
      )}
      {scan.loading && !hasScanned && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {hasScanned && items.length === 0 && !scan.loading && (
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-16">
          <p className="font-semibold text-foreground text-lg">No skills or configs found</p>
          <p className="text-center text-muted-foreground text-sm">
            Try scanning from a different directory or check that your agent configuration files are
            present.
          </p>
        </div>
      )}
      {skillItems.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Skills
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {skillItems.map((item) => (
              <DiscoverCard
                key={`${item.name}-${item.path}`}
                item={item}
                agents={getAgentsForItem(item)}
                onAdopt={() => handleAdoptSingle(item.name)}
              />
            ))}
          </div>
        </div>
      )}
      {configItems.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Agent Configs
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {configItems.map((item) => (
              <DiscoverCard
                key={`${item.name}-${item.path}`}
                item={item}
                agents={getAgentsForItem(item)}
                onAdopt={() => handleAdoptSingle(item.name)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
