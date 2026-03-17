import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Agent Compatibility' }

const AGENTS = [
  { name: 'Claude Code', id: 'claude-code', category: 'Universal' },
  { name: 'Cursor', id: 'cursor', category: 'Universal' },
  { name: 'GitHub Copilot', id: 'copilot', category: 'Universal' },
  { name: 'Windsurf', id: 'windsurf', category: 'Universal' },
  { name: 'Cline', id: 'cline', category: 'Universal' },
  { name: 'Continue', id: 'continue', category: 'Universal' },
  { name: 'Gemini CLI', id: 'gemini-cli', category: 'CLI' },
  { name: 'Roo Code', id: 'roo', category: 'IDE' },
  { name: 'Goose', id: 'goose', category: 'CLI' },
  { name: 'Junie', id: 'junie', category: 'IDE' },
  { name: 'Aider', id: 'aider', category: 'CLI' },
  { name: 'OpenCode', id: 'opencode', category: 'CLI' },
  { name: 'Codex', id: 'codex', category: 'CLI' },
  { name: 'Claude Cowork', id: 'claude-cowork', category: 'Platform' },
  { name: 'Kilo Code', id: 'kilo', category: 'IDE' },
  { name: 'Augment', id: 'augment', category: 'IDE' },
  { name: 'Trae', id: 'trae', category: 'IDE' },
  { name: 'Amp', id: 'amp', category: 'CLI' },
  { name: 'Kiro CLI', id: 'kiro-cli', category: 'CLI' },
  { name: 'Qwen Code', id: 'qwen-code', category: 'CLI' },
  { name: 'Adal', id: 'adal', category: 'IDE' },
  { name: 'Antigravity', id: 'antigravity', category: 'IDE' },
  { name: 'CodeBuddy', id: 'codebuddy', category: 'IDE' },
  { name: 'Command Code', id: 'command-code', category: 'CLI' },
  { name: 'Cortex', id: 'cortex', category: 'IDE' },
  { name: 'Crush', id: 'crush', category: 'CLI' },
  { name: 'Droid', id: 'droid', category: 'CLI' },
  { name: 'iFlow CLI', id: 'iflow-cli', category: 'CLI' },
  { name: 'Kimi CLI', id: 'kimi-cli', category: 'CLI' },
  { name: 'Kode', id: 'kode', category: 'IDE' },
  { name: 'MCPJam', id: 'mcpjam', category: 'Platform' },
  { name: 'Mistral Vibe', id: 'mistral-vibe', category: 'CLI' },
  { name: 'Mux', id: 'mux', category: 'IDE' },
  { name: 'Neovate', id: 'neovate', category: 'IDE' },
  { name: 'OpenClaw', id: 'openclaw', category: 'CLI' },
  { name: 'OpenHands', id: 'openhands', category: 'Platform' },
  { name: 'Pi', id: 'pi', category: 'CLI' },
  { name: 'Pochi', id: 'pochi', category: 'CLI' },
  { name: 'Qoder', id: 'qoder', category: 'CLI' },
  { name: 'Replit', id: 'replit', category: 'Platform' },
  { name: 'Trae CN', id: 'trae-cn', category: 'IDE' },
  { name: 'ZenCoder', id: 'zencoder', category: 'IDE' },
  { name: 'Amplify', id: 'amplify', category: 'IDE' },
]

export default function AgentsDocsPage() {
  return (
    <article>
      <h1 className="font-bold font-display text-3xl tracking-tight md:text-4xl">
        Agent Compatibility
      </h1>
      <p className="mt-4 text-lg text-muted leading-relaxed">
        Agentver supports 43 AI agents across four categories. Skills are automatically detected and
        connected to each agent&apos;s expected configuration location.
      </p>

      <section className="mt-10">
        <h2 className="font-display font-semibold text-xl tracking-tight">How detection works</h2>
        <ol className="mt-4 space-y-3 text-muted">
          <li className="flex gap-3">
            <span className="font-medium text-primary">1.</span> Run{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">
              agentver scan
            </code>{' '}
            to detect installed agents
          </li>
          <li className="flex gap-3">
            <span className="font-medium text-primary">2.</span> Skills are stored in a single
            canonical location
          </li>
          <li className="flex gap-3">
            <span className="font-medium text-primary">3.</span> Agentver automatically connects
            skills to each agent&apos;s config path
          </li>
          <li className="flex gap-3">
            <span className="font-medium text-primary">4.</span> Each agent picks up the skill from
            its expected location
          </li>
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="font-display font-semibold text-xl tracking-tight">All supported agents</h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-surface">
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Category</th>
              </tr>
            </thead>
            <tbody>
              {AGENTS.map((agent) => (
                <tr key={agent.id} className="border-border border-t">
                  <td className="px-4 py-2.5 font-medium">{agent.name}</td>
                  <td className="px-4 py-2.5">
                    <code className="font-mono text-muted text-xs">{agent.id}</code>
                  </td>
                  <td className="hidden px-4 py-2.5 text-muted sm:table-cell">{agent.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </article>
  )
}
