import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Introduction',
}

export default function DocsPage() {
  return (
    <article className="prose-agentver">
      <h1 className="font-bold font-display text-3xl tracking-tight md:text-4xl">Documentation</h1>
      <p className="mt-4 text-lg text-muted leading-relaxed">
        Agentver is an open-source platform for managing AI agent skills. Git-native version control
        for skills, plugins, configs, scripts, and prompts across 43+ agents.
      </p>

      <div className="mt-12 space-y-8">
        <section>
          <h2 className="font-display font-semibold text-xl tracking-tight">What is Agentver?</h2>
          <p className="mt-3 text-muted leading-relaxed">
            Think of Agentver as version control for AI agents. Instead of managing code
            repositories, you manage agent skills — the instructions, configurations, and workflows
            that make AI coding agents useful. The entire platform is open source. Everything is
            stored in Git, versioned with semantic tags, and secured with cryptographic integrity
            checks. You can self-host the platform or use our hosted cloud.
          </p>
        </section>

        <section>
          <h2 className="font-display font-semibold text-xl tracking-tight">Key concepts</h2>
          <ul className="mt-3 space-y-3 text-muted">
            <li className="flex gap-3">
              <span className="font-medium text-foreground">Skills</span>
              <span>— Agent instructions and workflows (SKILL.md entry point)</span>
            </li>
            <li className="flex gap-3">
              <span className="font-medium text-foreground">Agent Configs</span>
              <span>
                - Configuration overrides for specific agents (.cursorrules, CLAUDE.md, etc.)
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-medium text-foreground">Plugins</span>
              <span>— External tools and MCP integrations</span>
            </li>
            <li className="flex gap-3">
              <span className="font-medium text-foreground">Scripts</span>
              <span>— Executable automation (Node.js, Bun, Python, Bash)</span>
            </li>
            <li className="flex gap-3">
              <span className="font-medium text-foreground">Prompts</span>
              <span>— Reusable prompt templates with variable substitution</span>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display font-semibold text-xl tracking-tight">Quick start</h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
            <div className="border-border border-b px-4 py-2">
              <span className="font-mono text-muted text-xs">terminal</span>
            </div>
            <pre className="p-4 font-mono text-[13px] leading-[1.75]">
              <code>
                <span className="text-primary">$</span>{' '}
                <span className="text-foreground">bun add -g @agentver/cli</span>
                {'\n'}
                <span className="text-primary">$</span>{' '}
                <span className="text-foreground">
                  agentver install github.com/acme/deploy-checker
                </span>
                {'\n'}
                <span className="text-primary">$</span>{' '}
                <span className="text-foreground">agentver list</span>
              </code>
            </pre>
          </div>
        </section>

        <div className="flex flex-wrap gap-4 pt-4">
          <a
            href="/docs/quickstart"
            className="rounded-full bg-primary px-5 py-2.5 font-medium text-sm text-white transition-colors hover:bg-primary-bright"
          >
            Quickstart guide &rarr;
          </a>
          <a
            href="/docs/cli"
            className="rounded-full border border-border px-5 py-2.5 text-muted text-sm transition-colors hover:border-foreground/20 hover:text-foreground"
          >
            CLI reference
          </a>
          <a
            href="https://github.com/agentver/platform"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-5 py-2.5 text-muted text-sm transition-colors hover:border-foreground/20 hover:text-foreground"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
            </svg>
            GitHub
          </a>
        </div>
      </div>
    </article>
  )
}
