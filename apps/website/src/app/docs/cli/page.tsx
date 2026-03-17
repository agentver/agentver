import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'CLI Overview' }

const CATEGORIES = [
  {
    name: 'Package Management',
    commands: [
      { name: 'init', desc: 'Scaffold a new package (skill, config, plugin, script, or prompt)' },
      { name: 'install', desc: 'Install a skill from a Git repository or well-known domain' },
      { name: 'remove', desc: 'Remove an installed package' },
      { name: 'list', desc: 'Show installed packages with versions and sources' },
      { name: 'update', desc: 'Update installed skills to their latest upstream version' },
      {
        name: 'status',
        desc: 'Show status of installed skills (upstream changes, local modifications)',
      },
    ],
  },
  {
    name: 'Search & Discovery',
    commands: [
      {
        name: 'search',
        desc: 'Search for skills across the platform, skills.sh, and well-known domains',
      },
      { name: 'scan', desc: 'Detect installed agents and discover skills/configs in a directory' },
    ],
  },
  {
    name: 'Publishing & Versioning',
    commands: [
      { name: 'publish', desc: 'Publish a skill to the registry with security audit' },
      { name: 'save', desc: 'Commit local skill changes to the platform' },
      { name: 'version', desc: 'Create and list semantic version tags' },
      { name: 'draft', desc: 'Manage draft branches (create, list, switch, publish, discard)' },
      { name: 'log', desc: 'Show commit history for a skill' },
    ],
  },
  {
    name: 'Collaboration',
    commands: [
      { name: 'diff', desc: 'Show diff between local and upstream version of a skill' },
      { name: 'propose', desc: 'Create a change proposal from local modifications' },
      { name: 'proposals', desc: 'List open proposals' },
    ],
  },
  {
    name: 'Security',
    commands: [{ name: 'audit', desc: 'Run a security scan on installed skills or a directory' }],
  },
  {
    name: 'Platform',
    commands: [
      { name: 'sync', desc: 'Push local installation state to the platform' },
      { name: 'login', desc: 'Authenticate with the Agentver platform' },
      { name: 'logout', desc: 'Log out and clear credentials' },
      { name: 'whoami', desc: 'Show authentication state and connected organisations' },
    ],
  },
]

export default function CliOverviewPage() {
  return (
    <article>
      <h1 className="font-bold font-display text-3xl tracking-tight md:text-4xl">CLI Overview</h1>
      <p className="mt-4 text-lg text-muted leading-relaxed">
        The Agentver CLI covers everything you need for installing, versioning, publishing,
        auditing, and collaborating on AI agent skills. It works standalone or connected to the
        platform.
      </p>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-border border-b px-4 py-2">
          <span className="font-mono text-muted text-xs">install</span>
        </div>
        <pre className="p-4 font-mono text-[13px] leading-[1.75]">
          <code>
            <span className="text-primary">$</span> bun add -g @agentver/cli
          </code>
        </pre>
      </div>

      <div className="mt-10 space-y-10">
        {CATEGORIES.map((cat) => (
          <section key={cat.name}>
            <h2 className="font-display font-semibold text-xl tracking-tight">{cat.name}</h2>
            <div className="mt-4 space-y-2">
              {cat.commands.map((cmd) => (
                <a
                  key={cmd.name}
                  href={`/docs/cli/${cmd.name}`}
                  className="group flex items-start gap-4 rounded-lg border border-border bg-background p-4 transition-all hover:border-primary/30 hover:shadow-sm"
                >
                  <code className="shrink-0 font-medium font-mono text-foreground text-sm group-hover:text-primary">
                    agentver {cmd.name}
                  </code>
                  <span className="text-muted text-sm">{cmd.desc}</span>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  )
}
