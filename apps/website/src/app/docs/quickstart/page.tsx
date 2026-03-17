import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Quickstart' }

export default function QuickstartPage() {
  return (
    <article>
      <h1 className="font-bold font-display text-3xl tracking-tight md:text-4xl">Quickstart</h1>
      <p className="mt-4 text-lg text-muted leading-relaxed">
        Get up and running with Agentver in under a minute.
      </p>

      <section className="mt-10 space-y-8">
        <div>
          <h2 className="font-display font-semibold text-xl tracking-tight">1. Install the CLI</h2>
          <p className="mt-2 text-muted leading-relaxed">
            Install Agentver globally using Bun or npm:
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
            <div className="border-border border-b px-4 py-2">
              <span className="font-mono text-muted text-xs">terminal</span>
            </div>
            <pre className="p-4 font-mono text-[13px] leading-[1.75]">
              <code>
                <span className="text-primary">$</span> bun add -g @agentver/cli
              </code>
            </pre>
          </div>
          <p className="mt-2 text-muted text-sm">
            Or with npm:{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">
              npm install -g @agentver/cli
            </code>
          </p>
        </div>

        <div>
          <h2 className="font-display font-semibold text-xl tracking-tight">2. Scan for agents</h2>
          <p className="mt-2 text-muted leading-relaxed">
            Agentver auto-detects which AI agents you have installed:
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
            <div className="border-border border-b px-4 py-2">
              <span className="font-mono text-muted text-xs">terminal</span>
            </div>
            <pre className="p-4 font-mono text-[13px] leading-[1.75]">
              <code>
                <span className="text-primary">$</span> agentver scan{'\n'}
                <span className="text-muted"> found 3 agents:</span>
                {'\n'}
                <span className="text-primary"> ✓ claude-code ~/.claude/</span>
                {'\n'}
                <span className="text-primary"> ✓ cursor ~/.cursor/rules/</span>
                {'\n'}
                <span className="text-primary"> ✓ windsurf ~/.windsurf/rules/</span>
              </code>
            </pre>
          </div>
        </div>

        <div>
          <h2 className="font-display font-semibold text-xl tracking-tight">3. Install a skill</h2>
          <p className="mt-2 text-muted leading-relaxed">
            Install a skill from any Git repository. Agentver fetches the files, runs a security
            scan before anything touches your disk, installs to{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">
              .agentver/skills/
            </code>
            , connects it to all your detected agents, and records the source and integrity hash in
            your local manifest and lockfile:
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
            <div className="border-border border-b px-4 py-2">
              <span className="font-mono text-muted text-xs">terminal</span>
            </div>
            <pre className="p-4 font-mono text-[13px] leading-[1.75]">
              <code>
                <span className="text-primary">$</span> agentver install
                github.com/acme/deploy-checker{'\n'}
                <span className="text-muted"> ↓ fetching deploy-checker@2.1.0</span>
                {'\n'}
                <span className="text-primary"> ✓ security scan passed</span>
                {'\n'}
                <span className="text-primary"> ✓ verified integrity</span>
                {'\n'}
                <span className="text-primary"> ✓ installed to all detected agents</span>
              </code>
            </pre>
          </div>
        </div>

        <div className="rounded-xl border border-primary/20 bg-primary-light p-5">
          <h3 className="font-display font-semibold tracking-tight">What just happened?</h3>
          <ol className="mt-3 space-y-2 text-muted text-sm">
            <li>
              <span className="font-medium text-foreground">1. Fetched</span> the skill files from
              the Git repository
            </li>
            <li>
              <span className="font-medium text-foreground">2. Scanned</span> every file against 28
              security rules before writing to disk
            </li>
            <li>
              <span className="font-medium text-foreground">3. Installed</span> to{' '}
              <code className="rounded bg-white/60 px-1 py-0.5 font-mono text-xs">
                .agentver/skills/deploy-checker/
              </code>
            </li>
            <li>
              <span className="font-medium text-foreground">4. Connected</span> to all detected
              agents via symlinks (Claude Code, Cursor, Windsurf, etc.)
            </li>
            <li>
              <span className="font-medium text-foreground">5. Recorded</span> the source, version,
              and integrity hash in your local manifest and lockfile
            </li>
          </ol>
          <p className="mt-3 text-muted text-sm">
            This is a local operation. Nothing is published to the Agentver registry. Your agents
            can use the skill immediately.
          </p>
        </div>

        <div>
          <h2 className="font-display font-semibold text-xl tracking-tight">
            4. Check what you have
          </h2>
          <p className="mt-2 text-muted leading-relaxed">
            List installed skills, check their status, or see if updates are available:
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
            <div className="border-border border-b px-4 py-2">
              <span className="font-mono text-muted text-xs">terminal</span>
            </div>
            <pre className="p-4 font-mono text-[13px] leading-[1.75]">
              <code>
                <span className="text-primary">$</span> agentver list{'\n'}
                <span className="text-muted">
                  {' '}
                  deploy-checker 2.1.0 github.com/acme/deploy-checker
                </span>
                {'\n'}
                {'\n'}
                <span className="text-primary">$</span> agentver status{'\n'}
                <span className="text-primary"> ✓ deploy-checker up-to-date</span>
              </code>
            </pre>
          </div>
        </div>

        <div>
          <h2 className="font-display font-semibold text-xl tracking-tight">
            5. Publish your own skills
          </h2>
          <p className="mt-2 text-muted leading-relaxed">
            Installing pulls skills from external sources. To publish your own skills to the
            Agentver registry so others can install them, use{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">publish</code>:
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
            <div className="border-border border-b px-4 py-2">
              <span className="font-mono text-muted text-xs">terminal</span>
            </div>
            <pre className="p-4 font-mono text-[13px] leading-[1.75]">
              <code>
                <span className="text-primary">$</span> agentver init{'\n'}
                <span className="text-muted"> Created SKILL.md and manifest</span>
                {'\n'}
                {'\n'}
                <span className="text-muted"> ... edit your SKILL.md ...</span>
                {'\n'}
                {'\n'}
                <span className="text-primary">$</span> agentver publish --version 1.0.0{'\n'}
                <span className="text-primary"> ✓ security audit passed</span>
                {'\n'}
                <span className="text-primary"> ✓ published my-skill@1.0.0</span>
              </code>
            </pre>
          </div>
          <p className="mt-2 text-muted text-sm">
            You can also use{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">
              agentver save
            </code>{' '}
            to commit working changes without creating a version, and{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">
              agentver draft
            </code>{' '}
            to manage draft branches.
          </p>
        </div>

        <div>
          <h2 className="font-display font-semibold text-xl tracking-tight">Next steps</h2>
          <ul className="mt-3 space-y-2 text-muted">
            <li className="flex gap-2">
              <span className="text-primary">→</span>
              <a
                href="/docs/cli"
                className="text-primary transition-colors hover:text-primary-bright"
              >
                Explore all CLI commands
              </a>
            </li>
            <li className="flex gap-2">
              <span className="text-primary">→</span>
              <a
                href="/docs/skill-spec"
                className="text-primary transition-colors hover:text-primary-bright"
              >
                Learn about the skill spec format
              </a>
            </li>
            <li className="flex gap-2">
              <span className="text-primary">→</span>
              <a
                href="/docs/package-types"
                className="text-primary transition-colors hover:text-primary-bright"
              >
                Understand the 5 package types
              </a>
            </li>
            <li className="flex gap-2">
              <span className="text-primary">→</span>
              <a
                href="/docs/agents"
                className="text-primary transition-colors hover:text-primary-bright"
              >
                See all 43 supported agents
              </a>
            </li>
          </ul>
        </div>
      </section>
    </article>
  )
}
