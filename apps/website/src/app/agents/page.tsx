import type { Metadata } from 'next'
import { FadeIn } from '@/components/fade-in'
import { Terminal } from '@/components/terminal'

export const metadata: Metadata = {
  title: 'Agents',
  description:
    'Agentver works with 43+ AI coding agents - Claude Code, Cursor, Copilot, Windsurf, Gemini CLI, and more.',
}

type AgentDef = {
  name: string
  category: 'Universal' | 'IDE' | 'CLI' | 'Platform'
}

const ALL_AGENTS: AgentDef[] = [
  { name: 'Claude Code', category: 'Universal' },
  { name: 'Cursor', category: 'Universal' },
  { name: 'GitHub Copilot', category: 'Universal' },
  { name: 'Windsurf', category: 'Universal' },
  { name: 'Cline', category: 'Universal' },
  { name: 'Continue', category: 'Universal' },
  { name: 'Gemini CLI', category: 'CLI' },
  { name: 'Roo Code', category: 'IDE' },
  { name: 'Goose', category: 'CLI' },
  { name: 'Junie', category: 'IDE' },
  { name: 'Aider', category: 'CLI' },
  { name: 'OpenCode', category: 'CLI' },
  { name: 'Codex', category: 'CLI' },
  { name: 'Claude Cowork', category: 'Platform' },
  { name: 'Kilo Code', category: 'IDE' },
  { name: 'Augment', category: 'IDE' },
  { name: 'Trae', category: 'IDE' },
  { name: 'Amp', category: 'CLI' },
  { name: 'Kiro CLI', category: 'CLI' },
  { name: 'Qwen Code', category: 'CLI' },
  { name: 'Adal', category: 'IDE' },
  { name: 'Antigravity', category: 'IDE' },
  { name: 'CodeBuddy', category: 'IDE' },
  { name: 'Command Code', category: 'CLI' },
  { name: 'Cortex', category: 'IDE' },
  { name: 'Crush', category: 'CLI' },
  { name: 'Droid', category: 'CLI' },
  { name: 'iFlow CLI', category: 'CLI' },
  { name: 'Kimi CLI', category: 'CLI' },
  { name: 'Kode', category: 'IDE' },
  { name: 'MCPJam', category: 'Platform' },
  { name: 'Mistral Vibe', category: 'CLI' },
  { name: 'Mux', category: 'IDE' },
  { name: 'Neovate', category: 'IDE' },
  { name: 'OpenClaw', category: 'CLI' },
  { name: 'OpenHands', category: 'Platform' },
  { name: 'Pi', category: 'CLI' },
  { name: 'Pochi', category: 'CLI' },
  { name: 'Qoder', category: 'CLI' },
  { name: 'Replit', category: 'Platform' },
  { name: 'Trae CN', category: 'IDE' },
  { name: 'ZenCoder', category: 'IDE' },
  { name: 'Amplify', category: 'IDE' },
]

const CATEGORIES = ['Universal', 'IDE', 'CLI', 'Platform'] as const

const CATEGORY_INFO: Record<string, { label: string; desc: string; colour: string }> = {
  Universal: {
    label: 'Universal',
    desc: 'Works across IDEs and terminals',
    colour: 'bg-primary text-white',
  },
  IDE: {
    label: 'IDE',
    desc: 'IDE extensions and plugins',
    colour: 'bg-[oklch(0.55_0.12_265)] text-white',
  },
  CLI: { label: 'CLI', desc: 'Command-line tools', colour: 'bg-[oklch(0.55_0.10_200)] text-white' },
  Platform: {
    label: 'Platform',
    desc: 'Web-based and hosted',
    colour: 'bg-[oklch(0.60_0.12_50)] text-white',
  },
}

const PACKAGE_TYPES = [
  { type: 'Skills', desc: 'Agent instructions (SKILL.md)', agents: 'All agents' },
  {
    type: 'Agent Configs',
    desc: '.cursorrules, CLAUDE.md, etc.',
    agents: 'Per-agent (auto-translated)',
  },
  { type: 'Plugins', desc: 'MCP servers and tools', agents: 'MCP-capable agents' },
  { type: 'Scripts', desc: 'Node.js, Bun, Python, Bash', agents: 'All (executed standalone)' },
  { type: 'Prompts', desc: 'Templates with variables', agents: 'All agents' },
]

export default function AgentsPage() {
  return (
    <div className="min-h-screen">
      <AgentsHero />
      <AgentGrid />
      <DetectionFlow />
      <PackageMatrix />
    </div>
  )
}

function AgentsHero() {
  return (
    <section className="pt-32 pb-20 md:pt-40 md:pb-28">
      <div className="mx-auto max-w-6xl px-6 text-center">
        <div className="animate-fade-up">
          <h1 className="font-bold font-display text-4xl leading-tight tracking-tight md:text-6xl">
            One skill. <span className="text-primary">43 agents.</span>
            <br />
            Zero configuration.
          </h1>
          <p className="mx-auto mt-6 max-w-lg text-lg text-muted leading-relaxed">
            Agentver auto-detects your installed agents and connects skills to each one
            automatically. Write once, run everywhere.
          </p>
        </div>
      </div>
    </section>
  )
}

function AgentGrid() {
  return (
    <section className="py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <FadeIn>
          <div className="mb-8 flex flex-wrap items-center gap-3">
            <span className="text-muted text-sm">Filter:</span>
            {CATEGORIES.map((cat) => {
              const info = CATEGORY_INFO[cat]
              return (
                <span
                  key={cat}
                  className={`rounded-full px-3 py-1 font-medium text-xs ${info?.colour}`}
                >
                  {info?.label}
                </span>
              )
            })}
          </div>
        </FadeIn>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {ALL_AGENTS.map((agent, i) => {
            const info = CATEGORY_INFO[agent.category]
            return (
              <FadeIn key={agent.name} delay={Math.min(i * 30, 600)}>
                <div className="group rounded-xl border border-border bg-background p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground text-sm">{agent.name}</span>
                  </div>
                  <span
                    className={`mt-2 inline-block rounded-full px-2 py-0.5 font-medium text-[10px] ${info?.colour}`}
                  >
                    {info?.label}
                  </span>
                </div>
              </FadeIn>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function DetectionFlow() {
  return (
    <section className="bg-surface py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <FadeIn>
              <h2 className="font-display font-semibold text-3xl tracking-tight md:text-4xl">
                How agent detection works
              </h2>
              <div className="mt-8 space-y-6">
                {[
                  {
                    step: '1',
                    title: 'Scan',
                    desc: 'agentver scan checks known paths for each of the 43 agents.',
                  },
                  {
                    step: '2',
                    title: 'Detect',
                    desc: 'Found agents are recorded. Skills know which agents to target.',
                  },
                  {
                    step: '3',
                    title: 'Place',
                    desc: "Skills are installed once and automatically connected to each agent's expected location.",
                  },
                  {
                    step: '4',
                    title: 'Done',
                    desc: 'Each agent picks up the skill from its expected location. No manual config.',
                  },
                ].map((item) => (
                  <div key={item.step} className="flex gap-4">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-bold font-mono text-white text-xs">
                      {item.step}
                    </div>
                    <div>
                      <h3 className="font-display font-semibold">{item.title}</h3>
                      <p className="mt-1 text-muted text-sm">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
          <FadeIn delay={150}>
            <Terminal
              title="detection + placement"
              lines={[
                { text: 'agentver install github.com/acme/deploy-checker', type: 'command' },
                { text: '  ✓ installed to .agentver/skills/deploy-checker/', type: 'success' },
                { text: '', type: 'output' },
                { text: '  connected to detected agents:', type: 'comment' },
                { text: '  → ~/.claude/skills/deploy-checker', type: 'success' },
                { text: '  → ~/.cursor/rules/deploy-checker', type: 'success' },
                { text: '  → ~/.windsurf/rules/deploy-checker', type: 'success' },
                { text: '', type: 'output' },
                { text: '  3 agents updated. skill ready to use.', type: 'comment' },
              ]}
            />
          </FadeIn>
        </div>
      </div>
    </section>
  )
}

function PackageMatrix() {
  return (
    <section className="py-28 md:py-36">
      <div className="mx-auto max-w-4xl px-6">
        <FadeIn>
          <h2 className="text-center font-display font-semibold text-3xl tracking-tight md:text-4xl">
            Package type compatibility
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-center text-muted">
            Five package types, each with different agent compatibility.
          </p>
        </FadeIn>

        <FadeIn delay={100}>
          <div className="mt-12 overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-surface">
                  <th className="px-6 py-4 font-display font-semibold">Type</th>
                  <th className="px-6 py-4 font-display font-semibold">Description</th>
                  <th className="hidden px-6 py-4 font-display font-semibold md:table-cell">
                    Agent support
                  </th>
                </tr>
              </thead>
              <tbody>
                {PACKAGE_TYPES.map((pkg) => (
                  <tr key={pkg.type} className="border-border border-t">
                    <td className="px-6 py-4 font-medium">{pkg.type}</td>
                    <td className="px-6 py-4 text-muted">{pkg.desc}</td>
                    <td className="hidden px-6 py-4 text-muted md:table-cell">{pkg.agents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FadeIn>

        <FadeIn delay={200}>
          <div className="mt-10 text-center">
            <p className="text-muted text-sm">
              Don&apos;t see your agent?{' '}
              <span className="text-foreground">
                We add new agents regularly. Contributions welcome.
              </span>
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
