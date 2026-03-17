import type { Metadata } from 'next'
import { FadeIn } from '@/components/fade-in'
import { Terminal } from '@/components/terminal'

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Git-native versioning, 43+ agent support, built-in security scanner, MCP server catalogue, credential vault, team collaboration, import gateway, and a full developer CLI.',
}

const IMPORT_SOURCES = [
  { name: 'GitHub', icon: 'GH' },
  { name: 'GitLab', icon: 'GL' },
  { name: 'Bitbucket', icon: 'BB' },
  { name: 'Google Drive', icon: 'GD' },
  { name: 'OneDrive', icon: 'OD' },
]

export default function FeaturesPage() {
  return (
    <div className="min-h-screen">
      <FeaturesHero />
      <Versioning />
      <AgentSupport />
      <Security />
      <McpCatalogue />
      <CredentialVault />
      <Teams />
      <Import />
      <DeveloperExperience />
      <FeaturesCta />
    </div>
  )
}

function FeaturesHero() {
  return (
    <section className="pt-32 pb-20 md:pt-40 md:pb-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="animate-fade-up">
          <h1 className="font-bold font-display text-4xl leading-tight tracking-tight md:text-6xl">
            Everything you need to manage
            <br />
            <span className="text-primary">AI skills at scale</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted leading-relaxed">
            Whether you work from the terminal, a desktop app, or the team platform — these are the
            features that make Agentver the open-source standard for managing AI agent skills.
          </p>
        </div>
      </div>
    </section>
  )
}

function Versioning() {
  return (
    <section id="versioning" className="scroll-mt-20 py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <FadeIn>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary-light px-3 py-1">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary"
                >
                  <circle cx="12" cy="6" r="3" />
                  <path d="M12 9v6" />
                  <circle cx="7" cy="18" r="2" />
                  <circle cx="17" cy="18" r="2" />
                  <path d="M12 15l-5 3" />
                  <path d="M12 15l5 3" />
                </svg>
                <span className="font-mono text-primary text-xs">Git-native versioning</span>
              </div>
              <h2 className="font-display font-semibold text-3xl tracking-tight md:text-4xl">
                Real Git under the hood
              </h2>
              <p className="mt-4 text-muted leading-relaxed">
                Not a database pretending to be version control. Every skill lives in a real Git
                repository with real branches, real tags, and real commit history.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  'Semantic versioning with agentver version',
                  'Draft branches for experimentation',
                  'Full commit history with agentver log',
                  'Unified diffs with agentver diff',
                  'Cryptographic integrity verification on every file',
                  'Reliable, consistent installations every time',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-muted text-sm">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="mt-0.5 shrink-0 text-primary"
                    >
                      <path d="m9 12 2 2 4-4" />
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </FadeIn>
          </div>
          <FadeIn delay={150}>
            <Terminal
              title="version control"
              lines={[
                { text: 'agentver log deploy-checker', type: 'command' },
                { text: '  a1b2c3d  v2.0.0  Add error retry logic', type: 'output' },
                { text: '  e4f5g6h  v1.2.0  Improve validation rules', type: 'output' },
                { text: '  i7j8k9l  v1.1.0  Add timeout configuration', type: 'output' },
                { text: '  m0n1o2p  v1.0.0  Initial release', type: 'output' },
                { text: '', type: 'output' },
                { text: 'agentver diff deploy-checker', type: 'command' },
                { text: '  --- a/SKILL.md', type: 'output' },
                { text: '  +++ b/SKILL.md', type: 'output' },
                { text: '  @@ -12,3 +12,5 @@', type: 'comment' },
                { text: '  + retry_count: 3', type: 'success' },
                { text: '  + retry_delay: 1000', type: 'success' },
              ]}
            />
          </FadeIn>
        </div>
      </div>
    </section>
  )
}

function AgentSupport() {
  return (
    <section id="agents" className="scroll-mt-20 bg-surface py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <FadeIn delay={150} className="order-2 md:order-1">
            <Terminal
              title="agent detection"
              lines={[
                { text: 'agentver scan', type: 'command' },
                { text: '  scanning for AI agents...', type: 'output' },
                { text: '', type: 'output' },
                { text: '  ✓ claude-code   ~/.claude/', type: 'success' },
                { text: '  ✓ cursor        ~/.cursor/rules/', type: 'success' },
                { text: '  ✓ windsurf      ~/.windsurf/rules/', type: 'success' },
                { text: '  ✓ copilot       ~/.github/', type: 'success' },
                { text: '', type: 'output' },
                { text: '  4 agents detected. skills installed to all.', type: 'comment' },
              ]}
            />
          </FadeIn>
          <div className="order-1 md:order-2">
            <FadeIn>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary-light px-3 py-1">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="text-primary"
                >
                  <path d="M12 2a10 10 0 1 0 10 10" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                  <path d="M2 12h20" />
                  <path d="M12 2v20" />
                </svg>
                <span className="font-mono text-primary text-xs">Universal agent support</span>
              </div>
              <h2 className="font-display font-semibold text-3xl tracking-tight md:text-4xl">
                43 agents and counting
              </h2>
              <p className="mt-4 text-muted leading-relaxed">
                Agentver auto-detects which AI agents you have installed and automatically connects
                skills to each one. One skill works everywhere - zero manual configuration.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  'Automatic agent detection with agentver scan',
                  'Smart file placement - one source, everywhere you need it',
                  '5 package types: Skills, Configs, Plugins, Scripts, Prompts',
                  'Config translation between agent formats',
                  'Alias system for agent ID variants',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-muted text-sm">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="mt-0.5 shrink-0 text-primary"
                    >
                      <path d="m9 12 2 2 4-4" />
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href="/agents"
                className="mt-6 inline-block font-medium text-primary text-sm transition-colors hover:text-primary-bright"
              >
                See all 43 agents &rarr;
              </a>
            </FadeIn>
          </div>
        </div>
      </div>
    </section>
  )
}

function Security() {
  return (
    <section id="security" className="scroll-mt-20 py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <FadeIn>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary-light px-3 py-1">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="text-primary"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                <span className="font-mono text-primary text-xs">Built-in security</span>
              </div>
              <h2 className="font-display font-semibold text-3xl tracking-tight md:text-4xl">
                28 rules. Zero external deps.
              </h2>
              <p className="mt-4 text-muted leading-relaxed">
                Every install is scanned automatically. The built-in security scanner checks for
                dangerous commands, data exfiltration, obfuscated code, suspicious URLs, credential
                exposure, prompt injection, and remote code execution.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {[
                  'Dangerous commands',
                  'Data exfiltration',
                  'Obfuscated code',
                  'Suspicious URLs',
                  'Credential exposure',
                  'Prompt injection',
                  'Remote code execution',
                ].map((category, i) => (
                  <div key={category} className="flex items-center gap-2 text-muted text-sm">
                    <div
                      className={`size-2 rounded-full ${i < 2 ? 'bg-[oklch(0.65_0.15_25)]' : i < 4 ? 'bg-[oklch(0.70_0.12_85)]' : 'bg-primary'}`}
                    />
                    {category}
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
          <FadeIn delay={150}>
            <Terminal
              title="security audit"
              lines={[
                { text: 'agentver audit ./my-skills/', type: 'command' },
                { text: '  scanning 12 files across 3 skills...', type: 'output' },
                { text: '', type: 'output' },
                { text: '  ✓ deploy-checker    PASS  (0 issues)', type: 'success' },
                { text: '  ✓ code-reviewer     PASS  (0 issues)', type: 'success' },
                { text: '  ⚠ untrusted-skill   WARN  (2 medium)', type: 'comment' },
                { text: '    line 14: base64 decode detected', type: 'comment' },
                { text: '    line 31: suspicious URL pattern', type: 'comment' },
                { text: '', type: 'output' },
                { text: '  2/3 passed, 1 warning. no critical issues.', type: 'success' },
              ]}
            />
          </FadeIn>
        </div>
      </div>
    </section>
  )
}

function McpCatalogue() {
  return (
    <section id="mcp" className="scroll-mt-20 bg-surface py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <FadeIn delay={150} className="order-2 md:order-1">
            <Terminal
              title="MCP servers"
              lines={[
                { text: 'agentver mcp add github', type: 'command' },
                { text: '  ↓ fetching github MCP server', type: 'output' },
                { text: '  ✓ verified definition', type: 'success' },
                { text: '  ✓ configured for claude-code, cursor', type: 'success' },
                { text: '', type: 'output' },
                { text: 'agentver mcp add slack postgresql', type: 'command' },
                { text: '  ✓ added 2 MCP servers to your agents', type: 'success' },
              ]}
            />
          </FadeIn>
          <div className="order-1 md:order-2">
            <FadeIn>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary-light px-3 py-1">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="text-primary"
                >
                  <rect x="2" y="2" width="20" height="8" rx="2" />
                  <rect x="2" y="14" width="20" height="8" rx="2" />
                  <path d="M6 6h.01" />
                  <path d="M6 18h.01" />
                </svg>
                <span className="font-mono text-primary text-xs">MCP server catalogue</span>
              </div>
              <h2 className="font-display font-semibold text-3xl tracking-tight md:text-4xl">
                Discover and install MCP servers
              </h2>
              <p className="mt-4 text-muted leading-relaxed">
                Browse a curated catalogue of Model Context Protocol servers. Search by category,
                check verification status, and install with a single command. Your agents get tools
                for GitHub, Slack, databases, and dozens more.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  'Curated, verified MCP server definitions',
                  'One-command install across all your agents',
                  'Browse by category — dev tools, databases, communication, and more',
                  'Transport support — stdio, HTTP, SSE',
                  'Bundle MCP servers with skills and credentials',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-muted text-sm">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="mt-0.5 shrink-0 text-primary"
                    >
                      <path d="m9 12 2 2 4-4" />
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </FadeIn>
          </div>
        </div>
      </div>
    </section>
  )
}

function CredentialVault() {
  return (
    <section id="vault" className="scroll-mt-20 py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <FadeIn>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary-light px-3 py-1">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="text-primary"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  <circle cx="12" cy="16" r="1" />
                </svg>
                <span className="font-mono text-primary text-xs">Credential vault</span>
              </div>
              <h2 className="font-display font-semibold text-3xl tracking-tight md:text-4xl">
                Secrets, managed properly
              </h2>
              <p className="mt-4 text-muted leading-relaxed">
                Store API keys, tokens, and credentials for your MCP servers and integrations.
                Everything is encrypted with AES-256-GCM at rest, with granular sharing controls and
                full audit trails.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  'AES-256-GCM encryption at rest',
                  'Sharing modes — individual, team, or organisation',
                  'Rotation policies with configurable intervals',
                  'Expiry dates with automatic warnings',
                  'Full access logging for compliance',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-muted text-sm">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="mt-0.5 shrink-0 text-primary"
                    >
                      <path d="m9 12 2 2 4-4" />
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </FadeIn>
          </div>
          <FadeIn delay={150}>
            <div className="space-y-3">
              {[
                {
                  key: 'github-pat',
                  desc: 'GitHub personal access token',
                  sharing: 'Organisation',
                  sharingColour: 'bg-primary-light text-primary',
                  rotation: '90 days',
                },
                {
                  key: 'slack-bot-token',
                  desc: 'Slack bot OAuth token',
                  sharing: 'Team',
                  sharingColour: 'bg-[oklch(0.92_0.05_85)] text-[oklch(0.50_0.10_85)]',
                  rotation: '180 days',
                },
                {
                  key: 'postgres-url',
                  desc: 'Production database connection string',
                  sharing: 'Individual',
                  sharingColour: 'bg-[oklch(0.92_0.06_250)] text-[oklch(0.50_0.12_250)]',
                  rotation: '30 days',
                },
              ].map((secret) => (
                <div
                  key={secret.key}
                  className="rounded-xl border border-border bg-background p-4 transition-all duration-300 hover:border-primary/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium font-mono text-foreground text-sm">{secret.key}</p>
                      <p className="mt-0.5 text-muted text-xs">{secret.desc}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 font-medium text-xs ${secret.sharingColour}`}
                    >
                      {secret.sharing}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-muted text-xs">
                    <span>Rotates every {secret.rotation}</span>
                    <span>&middot;</span>
                    <span className="font-mono text-primary">
                      &#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  )
}

function Teams() {
  return (
    <section id="teams" className="scroll-mt-20 bg-surface py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <FadeIn>
          <div className="text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary-light px-3 py-1">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="text-primary"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span className="font-mono text-primary text-xs">Team collaboration</span>
            </div>
            <h2 className="font-display font-semibold text-3xl tracking-tight md:text-4xl">
              Collaborate like you already know how
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted leading-relaxed">
              Collaborate on AI skills the way modern teams work. Propose changes, review with your
              team, and keep everyone in sync. No Git knowledge required — the platform handles the
              complexity.
            </p>
          </div>
        </FadeIn>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: 'Organisations',
              desc: 'Create teams with custom namespaces. Every org gets its own skills repository backed by Git.',
            },
            {
              title: 'Permissions',
              desc: 'Customisable permission levels so the right people have the right access. Secure tokens for integrations.',
            },
            {
              title: 'Change proposals',
              desc: 'Propose changes to skills with diffs. Review workflow with approve, request changes, and comments.',
            },
            {
              title: 'Fork and sync',
              desc: 'Fork any skill to your namespace. Track upstream changes. Merge updates when you are ready.',
            },
            {
              title: 'Collections',
              desc: 'Curate skill sets for onboarding, projects, or teams. Share with your organisation or publicly.',
            },
            {
              title: 'Audit logging',
              desc: 'Every action is logged. Track who installed what, when proposals were merged, and all team activity.',
            },
          ].map((feature, i) => (
            <FadeIn key={feature.title} delay={i * 80}>
              <div className="rounded-xl border border-border bg-background p-6">
                <h3 className="font-display font-semibold tracking-tight">{feature.title}</h3>
                <p className="mt-2 text-muted text-sm leading-relaxed">{feature.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}

function Import() {
  return (
    <section id="import" className="scroll-mt-20 py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <FadeIn>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary-light px-3 py-1">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="text-primary"
                >
                  <path d="M12 5v14" />
                  <path d="m19 12-7 7-7-7" />
                  <path d="M5 3h14" />
                </svg>
                <span className="font-mono text-primary text-xs">Import gateway</span>
              </div>
              <h2 className="font-display font-semibold text-3xl tracking-tight md:text-4xl">
                Bring your skills from anywhere
              </h2>
              <p className="mt-4 text-muted leading-relaxed">
                Already have skills, prompts, or configs scattered across different tools? Connect
                GitHub, GitLab, Bitbucket, Google Drive, or OneDrive and import everything. It all
                lands in Git — versioned, secure, and ready to share.
              </p>
            </FadeIn>
          </div>
          <FadeIn delay={150}>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {IMPORT_SOURCES.map((source) => (
                <div
                  key={source.name}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                >
                  <div className="flex size-10 items-center justify-center rounded-lg bg-surface font-bold font-mono text-muted text-xs">
                    {source.icon}
                  </div>
                  <span className="text-center text-muted text-xs">{source.name}</span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  )
}

function DeveloperExperience() {
  return (
    <section id="dx" className="scroll-mt-20 bg-surface py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <FadeIn>
          <div className="text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary-light px-3 py-1">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="text-primary"
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="m7 15 3-3-3-3" />
                <path d="M13 15h4" />
              </svg>
              <span className="font-mono text-primary text-xs">Developer experience</span>
            </div>
            <h2 className="font-display font-semibold text-3xl tracking-tight md:text-4xl">
              Powerful when you need it
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted leading-relaxed">
              A complete CLI with automation support. A full API for custom integrations. Reliable,
              consistent installations every time.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={150}>
          <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2">
            <Terminal
              title="CI/CD integration"
              className="border-border bg-background"
              lines={[
                { text: 'agentver install --json | jq .installed', type: 'command' },
                { text: '  ["deploy-checker@2.0.0", "code-review@1.3.0"]', type: 'output' },
                { text: '', type: 'output' },
                { text: 'agentver audit --json | jq .verdict', type: 'command' },
                { text: '  "PASS"', type: 'success' },
              ]}
            />
            <Terminal
              title="lockfile"
              className="border-border bg-background"
              lines={[
                { text: 'cat .agentver/lockfile.json | jq .packages[0]', type: 'command' },
                { text: '  {', type: 'output' },
                { text: '    "name": "deploy-checker",', type: 'output' },
                { text: '    "version": "2.0.0",', type: 'output' },
                { text: '    "integrity": "sha256-a1b2c3...",', type: 'output' },
                { text: '    "resolved": "github.com/acme/..."', type: 'output' },
                { text: '  }', type: 'output' },
              ]}
            />
          </div>
        </FadeIn>

        <FadeIn delay={200}>
          <div className="mt-10 text-center">
            <a
              href="/cli"
              className="font-medium text-primary text-sm transition-colors hover:text-primary-bright"
            >
              Explore the CLI &rarr;
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}

function FeaturesCta() {
  return (
    <section className="py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6 text-center">
        <FadeIn>
          <h2 className="font-display font-semibold text-3xl tracking-tight md:text-4xl">
            Ready to get started?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted leading-relaxed">
            Everything is open source. Free for individuals, self-hostable, or use our cloud. Pick
            the path that suits you.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a
              href="/docs/quickstart"
              className="rounded-full bg-primary px-8 py-3.5 font-medium text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary-bright hover:shadow-primary/25 hover:shadow-xl"
            >
              Install the CLI
            </a>
            <a
              href="https://app.agentver.com/sign-up"
              className="rounded-full border border-primary/40 bg-primary-light px-8 py-3.5 font-medium text-primary transition-all hover:bg-primary hover:text-white"
            >
              Try the platform
            </a>
            <a
              href="/desktop"
              className="rounded-full border border-border px-8 py-3.5 text-muted transition-all hover:border-foreground/20 hover:text-foreground"
            >
              Download desktop
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
