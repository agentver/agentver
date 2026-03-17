import type { Metadata } from 'next'
import { FadeIn } from '@/components/fade-in'
import { Terminal } from '@/components/terminal'
import { TypingTerminal } from '@/components/typing-terminal'

export const metadata: Metadata = {
  title: 'CLI',
  description:
    'The Agentver CLI — install, version, publish, audit, and collaborate on AI agent skills. Open source.',
}

const COMMANDS = [
  {
    name: 'install',
    desc: 'Install skills from Git repos, well-known sources, or the platform',
    category: 'Core',
  },
  {
    name: 'list',
    desc: 'List installed skills with versions, refs, and compatible agents',
    category: 'Core',
  },
  { name: 'remove', desc: 'Remove installed skills with backup/restore support', category: 'Core' },
  {
    name: 'update',
    desc: 'Update skills to latest versions with merge strategies',
    category: 'Core',
  },
  {
    name: 'status',
    desc: 'Check state: up-to-date, locally modified, or upstream available',
    category: 'Core',
  },
  {
    name: 'pin',
    desc: 'Pin a package to skip it during updates',
    category: 'Core',
  },
  {
    name: 'unpin',
    desc: 'Unpin a package so it is included in updates',
    category: 'Core',
  },
  {
    name: 'search',
    desc: 'Query the platform registry, skills.sh, and well-known endpoints',
    category: 'Discovery',
  },
  {
    name: 'scan',
    desc: 'Detect installed agents and scan for skill/config files',
    category: 'Discovery',
  },
  {
    name: 'info',
    desc: 'Show detailed information about an installed package',
    category: 'Discovery',
  },
  {
    name: 'adopt',
    desc: 'Adopt existing skills and configs into Agentver management',
    category: 'Discovery',
  },
  {
    name: 'publish',
    desc: 'Publish skills to registry with security audit and semver',
    category: 'Publishing',
  },
  {
    name: 'save',
    desc: 'Save local changes to platform as working versions',
    category: 'Publishing',
  },
  {
    name: 'version',
    desc: 'Manage semantic versions and tags for published skills',
    category: 'Publishing',
  },
  {
    name: 'draft',
    desc: 'Manage draft branches (create, list, switch, publish, discard)',
    category: 'Publishing',
  },
  {
    name: 'log',
    desc: 'Show commit history for a skill with author/date metadata',
    category: 'Publishing',
  },
  {
    name: 'diff',
    desc: 'Show local vs upstream changes in unified diff format',
    category: 'Collaboration',
  },
  {
    name: 'suggest',
    desc: 'Create suggestions from local modifications for upstream skills',
    category: 'Collaboration',
  },
  {
    name: 'suggestions',
    desc: 'List, review, and manage suggestions on skills',
    category: 'Collaboration',
  },
  {
    name: 'audit',
    desc: 'Security scan on installed skills for known risks',
    category: 'Security',
  },
  {
    name: 'verify',
    desc: 'Verify a skill — checks publisher, integrity, and security',
    category: 'Security',
  },
  {
    name: 'sync',
    desc: 'Push local state to platform (machine ID, modified flags)',
    category: 'Platform',
  },
  { name: 'login', desc: 'Secure sign-in to connect to the platform', category: 'Platform' },
  { name: 'logout', desc: 'Clear platform credentials', category: 'Platform' },
  { name: 'whoami', desc: 'Show auth state and connected organisations', category: 'Platform' },
  {
    name: 'init',
    desc: 'Initialise a new Agentver project with manifest and structure',
    category: 'Core',
  },
  {
    name: 'config',
    desc: 'Manage CLI configuration (platform URL, default org, telemetry)',
    category: 'Configuration',
  },
  {
    name: 'doctor',
    desc: 'Run health checks to diagnose common issues',
    category: 'Configuration',
  },
  {
    name: 'upgrade',
    desc: 'Upgrade Agentver CLI to the latest version',
    category: 'Configuration',
  },
  {
    name: 'completion',
    desc: 'Generate shell completion scripts (bash, zsh, fish)',
    category: 'Configuration',
  },
]

const CATEGORIES = [
  'Core',
  'Discovery',
  'Publishing',
  'Collaboration',
  'Security',
  'Platform',
  'Configuration',
] as const

export default function CliPage() {
  return (
    <div className="min-h-screen">
      <CliHero />
      <InstallSection />
      <CommandReference />
      <Platforms />
    </div>
  )
}

function CliHero() {
  return (
    <section className="pt-32 pb-20 md:pt-40 md:pb-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
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
              <h1 className="font-bold font-display text-4xl leading-tight tracking-tight md:text-6xl">
                The power tool
                <br />
                <span className="text-primary">for agent skills</span>
              </h1>
              <p className="mt-6 max-w-lg text-lg text-muted leading-relaxed">
                Install, version, publish, audit, and collaborate on AI agent skills. Fully open
                source, works standalone. Prefer a GUI? There is a{' '}
                <a
                  href="/desktop"
                  className="text-primary transition-colors hover:text-primary-bright"
                >
                  desktop app
                </a>{' '}
                too.
              </p>
              <div className="mt-6">
                <a
                  href="https://github.com/agentver/agentver"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 font-medium text-primary text-sm transition-colors hover:text-primary-bright"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
                  </svg>
                  agentver/cli on GitHub &rarr;
                </a>
              </div>
            </div>
          </div>
          <div className="animate-fade-up [animation-delay:200ms]">
            <TypingTerminal
              title="agentver"
              steps={[
                {
                  command: 'agentver install github.com/acme/deploy-checker',
                  outputs: [
                    { text: '  ↓ fetching deploy-checker@2.1.0', type: 'output' },
                    { text: '  ✓ security scan passed (28 rules)', type: 'success' },
                    { text: '  ✓ verified integrity (sha256)', type: 'success' },
                    { text: '  ✓ installed → claude-code, cursor, windsurf', type: 'success' },
                  ],
                },
                {
                  command: 'agentver status',
                  outputs: [
                    { text: '  deploy-checker  2.1.0  ✓ up-to-date', type: 'success' },
                    { text: '  code-reviewer   1.3.0  ↑ update available (1.4.0)', type: 'output' },
                  ],
                },
              ]}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function InstallSection() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-3xl px-6">
        <FadeIn>
          <h2 className="text-center font-display font-semibold text-2xl tracking-tight md:text-3xl">
            Install in seconds
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 font-mono text-muted text-xs">via bun (recommended)</p>
              <Terminal
                lines={[{ text: 'bun add -g @agentver/cli', type: 'command' }]}
                showCursor={false}
              />
            </div>
            <div>
              <p className="mb-2 font-mono text-muted text-xs">via npm</p>
              <Terminal
                lines={[{ text: 'npm install -g @agentver/cli', type: 'command' }]}
                showCursor={false}
              />
            </div>
          </div>
          <p className="mt-6 text-center text-muted text-sm">
            Requires Node.js 24+ or Bun 1.3+. Works on macOS, Linux, and Windows.
          </p>
        </FadeIn>
      </div>
    </section>
  )
}

function CommandReference() {
  return (
    <section className="bg-surface py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <FadeIn>
          <h2 className="font-display font-semibold text-3xl tracking-tight md:text-4xl">
            Every command you need
          </h2>
          <p className="mt-4 text-lg text-muted">Everything you need. Nothing you don&apos;t.</p>
        </FadeIn>

        <div className="mt-12 space-y-10">
          {CATEGORIES.map((category) => {
            const cmds = COMMANDS.filter((c) => c.category === category)
            return (
              <FadeIn key={category}>
                <div>
                  <h3 className="mb-4 font-mono text-primary text-xs uppercase tracking-wider">
                    {category}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {cmds.map((cmd) => (
                      <a
                        key={cmd.name}
                        href={`/docs/cli/${cmd.name}`}
                        className="group rounded-xl border border-border bg-background p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                      >
                        <code className="font-medium font-mono text-foreground text-sm group-hover:text-primary">
                          agentver {cmd.name}
                        </code>
                        <p className="mt-1.5 text-muted text-xs leading-relaxed">{cmd.desc}</p>
                      </a>
                    ))}
                  </div>
                </div>
              </FadeIn>
            )
          })}
        </div>

        <FadeIn delay={100}>
          <div className="mt-12 text-center">
            <a
              href="/docs/cli"
              className="font-medium text-primary text-sm transition-colors hover:text-primary-bright"
            >
              Full CLI documentation &rarr;
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}

function Platforms() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <FadeIn>
          <h2 className="font-display font-semibold text-2xl tracking-tight">Works everywhere</h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
            {[
              { name: 'macOS', sub: 'Apple Silicon + Intel' },
              { name: 'Linux', sub: 'x64 + ARM64' },
              { name: 'Windows', sub: 'x64' },
            ].map((platform) => (
              <div
                key={platform.name}
                className="rounded-xl border border-border bg-surface px-8 py-5 text-center"
              >
                <div className="font-display font-semibold">{platform.name}</div>
                <div className="mt-1 text-muted text-xs">{platform.sub}</div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-muted text-sm">
            Prefer a GUI? Check out the{' '}
            <a
              href="/desktop"
              className="font-medium text-primary transition-colors hover:text-primary-bright"
            >
              desktop app
            </a>
            .
          </p>
        </FadeIn>
      </div>
    </section>
  )
}
