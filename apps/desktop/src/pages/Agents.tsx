import { cn } from '@agentver/ui-utils'
import { useState } from 'react'
import { useAgents } from '../hooks/useAgents'

const AGENT_COLOURS: Record<string, { dot: string; accent: string }> = {
  'claude-code': { dot: '#a855f7', accent: '#a855f7' },
  'claude-cowork': { dot: '#a855f7', accent: '#a855f7' },
  cursor: { dot: '#3b82f6', accent: '#3b82f6' },
  copilot: { dot: '#22c55e', accent: '#22c55e' },
  windsurf: { dot: '#14b8a6', accent: '#14b8a6' },
}
function getAgentColour(agentId: string) {
  return AGENT_COLOURS[agentId] ?? { dot: '#666', accent: '#666' }
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-6 py-5">
      <div className="h-4 w-[70%] animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
      <div className="h-3 w-[40%] animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
      <div className="mt-3 h-3.5 w-[60%] animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
    </div>
  )
}

const KNOWN_AGENTS = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'claude-cowork', name: 'Claude Cowork' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'copilot', name: 'GitHub Copilot' },
  { id: 'windsurf', name: 'Windsurf' },
  { id: 'codex', name: 'OpenAI Codex' },
  { id: 'gemini-cli', name: 'Gemini CLI' },
  { id: 'roo', name: 'Roo Code' },
  { id: 'goose', name: 'Goose' },
  { id: 'junie', name: 'JetBrains Junie' },
  { id: 'aider', name: 'Aider' },
  { id: 'cline', name: 'Cline' },
  { id: 'amp', name: 'Amp' },
  { id: 'trae', name: 'Trae' },
  { id: 'continue', name: 'Continue' },
  { id: 'kiro-cli', name: 'Kiro CLI' },
  { id: 'augment', name: 'Augment' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'openhands', name: 'OpenHands' },
  { id: 'kode', name: 'Kode' },
  { id: 'qwen-code', name: 'Qwen Code' },
  { id: 'replit', name: 'Replit' },
]

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

export function Agents() {
  const { agents, skills, loading, error, rescan } = useAgents()
  const detectedIds = new Set(agents.map((a) => a.id))
  const undetectedAgents = KNOWN_AGENTS.filter((a) => !detectedIds.has(a.id))
  const [showUndetected, setShowUndetected] = useState(false)

  function getSkillCountForAgent(
    agentId: string,
    agentSkills: { name: string; path: string; type: string }[]
  ): number {
    return agentSkills.filter((s) => s.type === agentId || s.path.includes(agentId)).length
  }

  return (
    <div className="mx-auto max-w-[1100px] px-10 py-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="mb-1 font-[family-name:var(--font-display)] font-semibold text-2xl text-foreground tracking-tight">
            Detected Agents
          </h1>
          <p className="text-muted-foreground text-sm">Agents found on your system</p>
        </div>
        <button
          onClick={rescan}
          disabled={loading}
          className={cn(
            'flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors',
            loading ? 'cursor-not-allowed opacity-50' : 'bg-muted hover:bg-accent'
          )}
        >
          <span className={cn('flex items-center', loading && 'animate-[spin_1s_linear_infinite]')}>
            <RefreshIcon />
          </span>
          <span>Re-scan</span>
        </button>
      </div>
      {error && (
        <div className="mb-6 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-[0.85rem] text-destructive">
          {error}
        </div>
      )}
      {loading && agents.length === 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {!loading && agents.length === 0 && !error && (
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
              <rect x="10" y="10" width="28" height="28" rx="4" />
              <rect x="16" y="16" width="16" height="16" rx="2" />
              <path d="M20 4v6M28 4v6M20 38v6M28 38v6M4 20h6M4 28h6M38 20h6M38 28h6" />
            </svg>
          </div>
          <p className="font-semibold text-foreground text-lg">No agents detected</p>
          <p className="text-center text-muted-foreground text-sm">
            Install a supported coding agent to get started.
          </p>
        </div>
      )}
      {agents.length > 0 && (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {agents.map((agent) => {
              const colour = getAgentColour(agent.id)
              return (
                <div
                  key={agent.id}
                  className="flex flex-col gap-3 rounded-2xl border bg-card px-6 py-5 transition-colors"
                  style={{ borderColor: `${colour.accent}33` }}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: colour.dot, boxShadow: `0 0 8px ${colour.dot}66` }}
                      />
                      <h3 className="font-semibold text-[1.05rem] text-foreground tracking-tight">
                        {agent.name}
                      </h3>
                    </div>
                    <span className="pl-[1.625rem] font-mono text-muted-foreground text-xs">
                      {agent.id}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="size-[7px] shrink-0 rounded-full bg-green-500" />
                    <span className="font-medium text-green-500 text-xs">Detected</span>
                  </div>
                  {agent.paths.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-[0.7rem] text-muted-foreground uppercase tracking-wider">
                        Config paths
                      </span>
                      {agent.paths.map((p) => (
                        <span key={p} className="truncate font-mono text-muted-foreground text-xs">
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between border-border border-t pt-2">
                    <span className="text-muted-foreground text-xs">Skills installed</span>
                    <span className="font-semibold text-foreground text-sm">
                      {getSkillCountForAgent(agent.id, skills)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          {undetectedAgents.length > 0 && (
            <div className="mt-8">
              <button
                onClick={() => setShowUndetected((v) => !v)}
                className="mb-4 flex cursor-pointer items-center gap-2 border-none bg-none p-2 font-[inherit] text-[0.825rem] text-muted-foreground"
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
                  className={cn(
                    'text-muted-foreground transition-transform',
                    showUndetected && 'rotate-90'
                  )}
                >
                  <path d="M5 3l4 4-4 4" />
                </svg>
                <span>
                  {undetectedAgents.length} other supported agent
                  {undetectedAgents.length === 1 ? '' : 's'}
                </span>
              </button>
              {showUndetected && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
                  {undetectedAgents.map((agent) => {
                    const colour = getAgentColour(agent.id)
                    return (
                      <div
                        key={agent.id}
                        className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-6 py-5 opacity-45"
                      >
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="size-2.5 shrink-0 rounded-full opacity-40"
                              style={{ background: colour.dot }}
                            />
                            <h3 className="font-semibold text-[1.05rem] text-foreground tracking-tight">
                              {agent.name}
                            </h3>
                          </div>
                          <span className="pl-[1.625rem] font-mono text-muted-foreground text-xs">
                            {agent.id}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="size-[7px] shrink-0 rounded-full bg-muted-foreground" />
                          <span className="font-medium text-muted-foreground text-xs">
                            Not detected
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
