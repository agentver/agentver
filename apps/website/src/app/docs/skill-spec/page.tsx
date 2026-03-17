import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Skill Spec' }

export default function SkillSpecPage() {
  return (
    <article>
      <h1 className="font-bold font-display text-3xl tracking-tight md:text-4xl">Skill Spec</h1>
      <p className="mt-4 text-lg text-muted leading-relaxed">
        The skill spec defines how AI agent skills are structured, discovered, and installed. Every
        skill has a{' '}
        <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-sm">SKILL.md</code> entry
        point.
      </p>

      <section className="mt-10">
        <h2 className="font-display font-semibold text-xl tracking-tight">SKILL.md format</h2>
        <p className="mt-2 text-muted leading-relaxed">
          A skill is defined by a{' '}
          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">SKILL.md</code> file
          with YAML frontmatter and markdown content:
        </p>
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-border border-b px-4 py-2">
            <span className="font-mono text-muted text-xs">SKILL.md</span>
          </div>
          <pre className="p-4 font-mono text-[13px] text-foreground leading-[1.75]">
            {`---
name: deploy-checker
description: Validates deployment configurations
version: 2.1.0
author: acme
license: MIT
compatibility:
  - claude-code
  - cursor
  - windsurf
---

# Deploy Checker

You are a deployment validation specialist.

## Instructions

When asked to review a deployment configuration...`}
          </pre>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display font-semibold text-xl tracking-tight">Frontmatter fields</h2>
        <div className="mt-4 space-y-2">
          {[
            { field: 'name', desc: 'Unique skill identifier (kebab-case)', required: true },
            {
              field: 'description',
              desc: 'Short description of what the skill does',
              required: true,
            },
            { field: 'version', desc: 'Semantic version (e.g. 2.1.0)', required: false },
            { field: 'author', desc: 'Skill author or organisation', required: false },
            { field: 'license', desc: 'SPDX license identifier', required: false },
            { field: 'compatibility', desc: 'List of compatible agent IDs', required: false },
          ].map((f) => (
            <div
              key={f.field}
              className="flex items-start gap-3 rounded-lg border border-border bg-background p-3"
            >
              <code className="shrink-0 rounded bg-surface px-2 py-0.5 font-mono text-sm">
                {f.field}
              </code>
              <span className="text-muted text-sm">
                {f.desc}
                {f.required && <span className="ml-1 font-medium text-primary">(required)</span>}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display font-semibold text-xl tracking-tight">Directory structure</h2>
        <p className="mt-2 text-muted leading-relaxed">
          Skills are installed to a canonical directory and automatically connected to each detected
          agent:
        </p>
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
          <pre className="p-4 font-mono text-[13px] text-muted leading-[1.75]">
            {`.agentver/
  manifest.json        # Installed packages
  lockfile.json        # Integrity hashes
  skills/
    deploy-checker/    # Canonical location
      SKILL.md
      ...`}
          </pre>
        </div>
      </section>
    </article>
  )
}
