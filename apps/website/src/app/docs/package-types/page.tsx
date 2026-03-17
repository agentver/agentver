import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Package Types' }

const TYPES = [
  {
    name: 'Skill',
    entry: 'SKILL.md',
    desc: 'Agent instructions and workflows. The core package type. A SKILL.md file contains frontmatter metadata and markdown instructions that agents follow.',
    example: 'A deployment validation skill that checks configuration files before deployment.',
  },
  {
    name: 'Agent Config',
    entry: '.cursorrules, CLAUDE.md, etc.',
    desc: 'Configuration overrides for specific agents. Agentver automatically translates between agent config formats so one config can work across agents.',
    example: 'A .cursorrules file that sets coding standards for your team.',
  },
  {
    name: 'Plugin',
    entry: 'plugin.json + optional MCP server',
    desc: 'External tools and integrations. Plugins can include MCP (Model Context Protocol) server definitions for agents that support tool use.',
    example: 'A database query plugin that gives agents access to your schema.',
  },
  {
    name: 'Script',
    entry: 'Manifest metadata + executable',
    desc: 'Executable automation scripts in Node.js, Bun, Python, or Bash. Scripts run standalone and can be invoked by agents or CI/CD pipelines.',
    example: 'A pre-commit hook that validates skill integrity before pushing.',
  },
  {
    name: 'Prompt',
    entry: 'PROMPT.md with frontmatter',
    desc: 'Reusable prompt templates with variable substitution. Prompts have typed parameters that can be filled in at runtime.',
    example: 'A code review prompt template with parameters for language and focus area.',
  },
]

export default function PackageTypesPage() {
  return (
    <article>
      <h1 className="font-bold font-display text-3xl tracking-tight md:text-4xl">Package Types</h1>
      <p className="mt-4 text-lg text-muted leading-relaxed">
        Agentver manages five types of packages - covering the full range of assets that make AI
        agents useful.
      </p>

      <div className="mt-10 space-y-8">
        {TYPES.map((type) => (
          <section key={type.name} className="rounded-xl border border-border bg-background p-6">
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-display font-semibold text-xl tracking-tight">{type.name}</h2>
              <code className="shrink-0 rounded bg-surface px-2 py-1 font-mono text-muted text-xs">
                {type.entry}
              </code>
            </div>
            <p className="mt-3 text-muted leading-relaxed">{type.desc}</p>
            <p className="mt-2 text-muted-light text-sm">
              <span className="font-medium text-muted">Example:</span> {type.example}
            </p>
          </section>
        ))}
      </div>
    </article>
  )
}
