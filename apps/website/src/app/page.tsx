import {
  BranchMultiCurve,
  BranchNode,
  BranchSegment,
  BranchTimeline,
  BranchWisps,
} from '@/components/branch-timeline'
import { FadeIn } from '@/components/fade-in'
import { LogoIcon } from '@/components/logo'
import { Terminal } from '@/components/terminal'

const HERO_AGENTS = ['Claude Code', 'Cursor', 'Copilot', 'Windsurf', 'Gemini CLI'] as const

const AGENTS = [
  'Claude Code',
  'Cursor',
  'GitHub Copilot',
  'Windsurf',
  'Gemini CLI',
  'Roo Code',
  'Goose',
  'Junie',
  'Aider',
  'OpenCode',
  'Codex',
  'Claude Cowork',
  'Kilo Code',
  'Augment',
  'Continue',
  'Trae',
  'Amp',
  'Cline',
  'Kiro CLI',
  'Qwen Code',
] as const

export default function HomePage() {
  return (
    <BranchTimeline>
      <BranchWisps />
      <Hero />
      <BranchNode label="init" colour="green" size="lg" />
      <BranchMultiCurve
        pairs={[
          ['green', 'teal'],
          ['green', 'blue'],
        ]}
        direction="fork"
      />
      <ThreePillars />
      <BranchMultiCurve
        pairs={[
          ['teal', 'green'],
          ['blue', 'green'],
        ]}
        direction="merge"
      />
      <BranchNode label="v1.0 - your way" colour="green" />
      <BranchSegment />
      <HowItWorks />
      <BranchNode label="v1.1 - add skills" colour="teal" />
      <BranchMultiCurve pairs={[['green', 'teal']]} direction="fork" />
      <PackageTypes />
      <BranchMultiCurve pairs={[['teal', 'green']]} direction="merge" />
      <BranchNode label="v1.2 - five types" colour="green" />
      <BranchSegment />
      <Features />
      <BranchNode label="v2.0 - full platform" colour="green" size="lg" />
      <BranchMultiCurve
        pairs={[
          ['green', 'teal'],
          ['green', 'blue'],
        ]}
        direction="fork"
      />
      <AgentCompat />
      <BranchMultiCurve
        pairs={[
          ['teal', 'green'],
          ['blue', 'green'],
        ]}
        direction="merge"
      />
      <BranchNode label="v2.1 - 43 agents" colour="teal" />
      <BranchSegment />
      <GetStarted />
    </BranchTimeline>
  )
}

function Hero() {
  return (
    <section className="pt-36 pb-20 md:pt-48 md:pb-12">
      <div className="mx-auto max-w-6xl px-6 md:pl-48 lg:pl-56">
        <div className="max-w-2xl">
          <div className="animate-fade-up">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-light px-4 py-1.5">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-primary"
              >
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
              </svg>
              <span className="font-medium text-primary text-xs">Open source</span>
            </div>
            <h1 className="font-bold font-display text-5xl leading-[1.06] tracking-tight md:text-7xl">
              The GitHub
              <br />
              <span className="text-primary">for AI agents</span>
            </h1>
          </div>

          <p className="mt-8 max-w-lg animate-fade-up text-lg text-muted leading-relaxed [animation-delay:100ms] md:text-xl">
            Manage, version, and share AI agent skills across 43+ agents. Import what you already
            have, keep everything in sync, and collaborate with your team — from the terminal,
            desktop, or browser.
          </p>

          <div className="mt-10 flex animate-fade-up flex-wrap items-center gap-3 [animation-delay:200ms]">
            <a
              href="/docs/quickstart"
              className="rounded-full bg-primary px-7 py-3.5 font-medium text-sm text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary-bright hover:shadow-primary/25 hover:shadow-xl"
            >
              Get started
            </a>
            <a
              href="https://app.agentver.com/sign-up"
              className="rounded-full border border-primary/40 bg-primary-light px-7 py-3.5 font-medium text-primary text-sm transition-all hover:bg-primary hover:text-white"
            >
              Try the platform
            </a>
            <a
              href="https://github.com/agentver/platform"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-border px-7 py-3.5 text-muted text-sm transition-all hover:border-foreground/20 hover:text-foreground"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
              </svg>
              View on GitHub
            </a>
          </div>

          <div className="mt-12 flex animate-fade-up flex-wrap items-center gap-2 [animation-delay:350ms]">
            <span className="text-muted-light text-sm">Works with</span>
            {HERO_AGENTS.map((agent) => (
              <span
                key={agent}
                className="rounded-full border border-border bg-background px-3 py-1 font-medium text-muted text-xs"
              >
                {agent}
              </span>
            ))}
            <a
              href="/agents"
              className="rounded-full bg-primary-light px-3 py-1 font-medium text-primary text-xs transition-colors hover:bg-primary hover:text-white"
            >
              +38 more
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

function ThreePillars() {
  const pillars = [
    {
      icon: (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="6" r="3" />
          <path d="M12 9v6" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="18" r="2" />
          <path d="M12 15l-5 3" />
          <path d="M12 15l5 3" />
        </svg>
      ),
      title: 'Version control, not just installation',
      desc: 'Track every change, roll back mistakes, and see the full history of your skills. Collaborate with proposals and reviews — whether you are technical or not, your AI toolkit is always under control.',
    },
    {
      icon: (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
        </svg>
      ),
      title: 'Use it your way',
      desc: 'Pick the surface that suits you. A powerful CLI for developers, a native desktop app for visual workflows, or a browser-based platform for collaboration. Everything is open source.',
    },
    {
      icon: (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
        </svg>
      ),
      title: 'Open source & free',
      desc: 'The entire platform is open source. Install, version, audit, and manage skills without paying a penny. Self-host or use our cloud — when your team needs collaboration, plans start at $4/seat.',
    },
  ]

  return (
    <section className="py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6 md:pl-48 lg:pl-56">
        <FadeIn>
          <div className="max-w-2xl">
            <h2 className="font-display font-semibold text-3xl tracking-tight md:text-5xl">
              Your way, your tools
            </h2>
            <p className="mt-5 text-lg text-muted leading-relaxed">
              Whether you live in the terminal, prefer a desktop app, or want a browser-based
              dashboard — Agentver meets you where you are.
            </p>
          </div>
        </FadeIn>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
          {pillars.map((pillar, i) => (
            <FadeIn key={pillar.title} delay={i * 120}>
              <div className="group h-full rounded-2xl border border-border bg-background p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/[0.04]">
                <div className="flex size-13 items-center justify-center rounded-2xl bg-primary-light text-primary transition-all duration-300 group-hover:bg-primary group-hover:text-white group-hover:shadow-md group-hover:shadow-primary/20">
                  {pillar.icon}
                </div>
                <h3 className="mt-6 font-display font-semibold text-xl tracking-tight">
                  {pillar.title}
                </h3>
                <p className="mt-3 text-muted leading-relaxed">{pillar.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Pick your surface',
      desc: 'Install the open-source CLI, download the desktop app, or sign up for the team platform. Agentver auto-detects which AI agents you have — Claude Code, Cursor, Windsurf, and 40 more.',
    },
    {
      n: '02',
      title: 'Add skills from anywhere',
      desc: 'Import skills you already have from GitHub, GitLab, Google Drive, OneDrive, or any Git repo. Bring your existing work — everything is versioned and security-checked automatically.',
    },
    {
      n: '03',
      title: 'Version, share, collaborate',
      desc: 'Publish versions, create draft branches, propose changes, fork and sync. Full git-powered collaboration for your AI toolkit.',
    },
  ]

  return (
    <section id="how-it-works" className="py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6 md:pl-48 lg:pl-56">
        <FadeIn>
          <h2 className="font-display font-semibold text-3xl tracking-tight md:text-5xl">
            How it works
          </h2>
          <p className="mt-5 max-w-xl text-lg text-muted leading-relaxed">
            From zero to version-controlled AI skills in three steps — however you prefer to work.
          </p>
        </FadeIn>

        <div className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-16">
          <div className="space-y-12">
            {steps.map((step, i) => (
              <FadeIn key={step.n} delay={i * 120}>
                <div className="flex gap-5">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-light font-bold font-display text-primary text-sm">
                    {step.n}
                  </div>
                  <div>
                    <h3 className="font-display font-semibold text-xl tracking-tight">
                      {step.title}
                    </h3>
                    <p className="mt-2 text-muted leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>

          <FadeIn delay={200}>
            <div className="md:sticky md:top-28">
              <Terminal
                title="quick start"
                lines={[
                  { text: 'agentver install github.com/acme/deploy-checker', type: 'command' },
                  { text: '  ↓ fetching deploy-checker@2.1.0', type: 'output' },
                  { text: '  ✓ security scan passed', type: 'success' },
                  { text: '  ✓ verified integrity', type: 'success' },
                  { text: '  ✓ installed to all detected agents', type: 'success' },
                ]}
              />
              <p className="mt-5 text-center text-muted text-sm">
                Not a terminal person? Use the{' '}
                <a
                  href="/desktop"
                  className="font-medium text-primary transition-colors hover:text-primary-bright"
                >
                  desktop app
                </a>{' '}
                or the{' '}
                <a
                  href="https://app.agentver.com"
                  className="font-medium text-primary transition-colors hover:text-primary-bright"
                >
                  team platform
                </a>{' '}
                instead.
              </p>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  )
}

function PackageTypes() {
  const types = [
    { name: 'Skills', desc: 'Agent instructions and workflows', icon: '📘' },
    { name: 'Configs', desc: 'Per-agent configuration overrides', icon: '⚙️' },
    { name: 'Plugins', desc: 'MCP servers and tool integrations', icon: '🔌' },
    { name: 'Scripts', desc: 'Executable automation', icon: '⚡' },
    { name: 'Prompts', desc: 'Reusable prompt templates', icon: '💬' },
  ]

  return (
    <section className="py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6 md:pl-48 lg:pl-56">
        <FadeIn>
          <div className="max-w-2xl">
            <h2 className="font-display font-semibold text-3xl tracking-tight md:text-5xl">
              Not just skills
            </h2>
            <p className="mt-5 text-lg text-muted leading-relaxed">
              Five package types for your entire AI toolkit. One tool to manage them all.
            </p>
          </div>
        </FadeIn>

        <div className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {types.map((type, i) => (
            <FadeIn key={type.name} delay={i * 80}>
              <div className="group flex flex-col items-center rounded-2xl border border-border bg-background p-6 text-center transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-md">
                <span className="text-2xl" role="img" aria-label={type.name}>
                  {type.icon}
                </span>
                <h3 className="mt-3 font-medium text-foreground text-sm">{type.name}</h3>
                <p className="mt-1 text-muted text-xs leading-relaxed">{type.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}

function Features() {
  const features = [
    {
      title: 'Git-native versioning',
      desc: 'Real Git under the hood - branches, tags, diffs, and commit history. Pure version control for your AI skills.',
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="6" r="3" />
          <path d="M12 9v6" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="18" r="2" />
          <path d="M12 15l-5 3" />
          <path d="M12 15l5 3" />
        </svg>
      ),
      link: '/features#versioning',
    },
    {
      title: '43+ agent support',
      desc: 'Automatic detection and installation. One skill, every agent, zero configuration.',
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2a10 10 0 1 0 10 10" />
          <path d="M12 2a10 10 0 0 1 10 10" />
          <path d="M2 12h20" />
          <path d="M12 2v20" />
        </svg>
      ),
      link: '/features#agents',
    },
    {
      title: 'Security scanner',
      desc: 'Built-in scanning on every install. Checks for dangerous patterns and known risks automatically.',
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      ),
      link: '/features#security',
    },
    {
      title: 'Team collaboration',
      desc: 'Organise skills across your team with workspaces, permissions, and proposal-based reviews. Everyone stays in sync.',
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
      link: '/features#teams',
    },
    {
      title: 'Import from anywhere',
      desc: 'Already have skills scattered across GitHub, Google Drive, or OneDrive? Import them all. Everything lands in Git, versioned and secure.',
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14" />
          <path d="m19 12-7 7-7-7" />
          <path d="M5 3h14" />
        </svg>
      ),
      link: '/features#import',
    },
    {
      title: 'MCP server catalogue',
      desc: 'Browse, search, and install Model Context Protocol servers from a curated catalogue. Verified definitions ready for your agents.',
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="2" width="20" height="8" rx="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" />
          <path d="M6 6h.01" />
          <path d="M6 18h.01" />
        </svg>
      ),
      link: '/features#mcp',
    },
    {
      title: 'Credential vault',
      desc: 'Encrypted secret storage for MCP servers and integrations. Sharing controls, rotation policies, and full access logging.',
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          <circle cx="12" cy="16" r="1" />
        </svg>
      ),
      link: '/features#vault',
    },
    {
      title: 'Developer tools',
      desc: 'A complete CLI with automation support. Full API for custom integrations. Built for teams that move fast.',
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 15 3-3-3-3" />
          <path d="M13 15h4" />
        </svg>
      ),
      link: '/features#dx',
    },
  ]

  return (
    <section id="features" className="py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6 md:pl-48 lg:pl-56">
        <FadeIn>
          <h2 className="font-display font-semibold text-3xl tracking-tight md:text-5xl">
            Everything you need
          </h2>
          <p className="mt-5 max-w-xl text-lg text-muted leading-relaxed">
            The full lifecycle for AI agent skills - from discovery to deployment.
          </p>
        </FadeIn>

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <FadeIn key={f.title} delay={i * 80}>
              <a
                href={f.link}
                className="group block h-full rounded-2xl border border-border bg-surface/50 p-7 transition-all duration-300 hover:-translate-y-0.5 hover:bg-background hover:shadow-lg hover:shadow-primary/[0.04]"
              >
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary-light text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-white">
                  {f.icon}
                </div>
                <h3 className="mt-5 font-display font-semibold text-lg tracking-tight">
                  {f.title}
                </h3>
                <p className="mt-2 text-muted leading-relaxed">{f.desc}</p>
                <span className="mt-4 inline-block text-primary text-sm opacity-0 transition-all duration-300 group-hover:opacity-100">
                  Learn more &rarr;
                </span>
              </a>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}

function AgentCompat() {
  return (
    <section className="py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6 md:pl-48 lg:pl-56">
        <FadeIn>
          <div className="max-w-2xl">
            <h2 className="font-display font-semibold text-3xl tracking-tight md:text-5xl">
              Works with every agent
            </h2>
            <p className="mt-5 text-lg text-muted leading-relaxed">
              One skill. Forty-three agents. Zero configuration. Automatic detection, automatic
              installation.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={150}>
          <div className="mt-12 flex max-w-3xl flex-wrap items-center gap-3">
            {AGENTS.map((agent) => (
              <span
                key={agent}
                className="rounded-full border border-border bg-background px-4 py-2.5 font-medium text-foreground text-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
              >
                {agent}
              </span>
            ))}
            <a
              href="/agents"
              className="rounded-full bg-primary-light px-4 py-2.5 font-medium text-primary text-sm transition-colors hover:bg-primary hover:text-white"
            >
              +23 more
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}

function GetStarted() {
  return (
    <section className="bg-dark-bg py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6 md:pl-48 lg:pl-56">
        <div className="max-w-2xl">
          <FadeIn>
            <LogoIcon className="h-14 w-auto text-primary" />
            <h2 className="mt-6 font-display font-semibold text-3xl text-dark-text tracking-tight md:text-5xl">
              Ready to take control of your AI toolkit?
            </h2>
            <p className="mt-5 max-w-lg text-dark-muted text-lg leading-relaxed">
              Fully open source and free to start. Install the CLI, self-host the platform, or try
              our cloud.
            </p>
          </FadeIn>

          <FadeIn delay={100}>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <a
                href="/docs/quickstart"
                className="rounded-full bg-primary px-8 py-3.5 font-medium text-white shadow-lg shadow-primary/25 transition-all hover:bg-primary-bright hover:shadow-primary/35 hover:shadow-xl"
              >
                Get started
              </a>
              <a
                href="https://app.agentver.com/sign-up"
                className="rounded-full border border-dark-border bg-dark-surface/50 px-8 py-3.5 font-medium text-dark-text transition-all hover:bg-primary-light hover:text-primary"
              >
                Try the platform
              </a>
              <a
                href="https://github.com/agentver/platform"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-dark-border px-8 py-3.5 text-dark-muted transition-all hover:border-dark-muted/40 hover:text-dark-text"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
                </svg>
                View on GitHub
              </a>
              <a
                href="/docs"
                className="rounded-full border border-dark-border px-8 py-3.5 text-dark-muted transition-all hover:border-dark-muted/40 hover:text-dark-text"
              >
                Read the docs
              </a>
            </div>
          </FadeIn>

          <FadeIn delay={200}>
            <div className="mt-12 max-w-xs">
              <div className="rounded-xl border border-dark-border bg-dark-surface/50 p-4 font-mono text-[13px] text-dark-muted">
                <span className="text-primary">$</span> bun add -g @agentver/cli
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  )
}
