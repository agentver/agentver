import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

type CommandDoc = {
  name: string
  description: string
  usage: string
  args?: { name: string; desc: string; required: boolean }[]
  options?: { flag: string; desc: string }[]
  subcommands?: { name: string; desc: string; usage: string }[]
  examples: { cmd: string; desc: string }[]
  notes?: string
  related?: { name: string; why: string }[]
}

const COMMANDS: Record<string, CommandDoc> = {
  init: {
    name: 'init',
    description: 'Scaffold a new Agentver package with a template directory structure.',
    usage: 'agentver init',
    options: [
      {
        flag: '--type <type>',
        desc: 'Package type: skill, agent, plugin, script, prompt (default: skill)',
      },
      { flag: '--repo', desc: 'Scaffold in a Git-repo-friendly structure' },
    ],
    examples: [
      { cmd: 'agentver init', desc: 'Create a new skill interactively' },
      { cmd: 'agentver init --type plugin', desc: 'Create a new plugin package' },
    ],
    related: [
      { name: 'publish', why: 'Publish your new skill to the registry' },
      { name: 'scan', why: 'Check which agents will pick up your skill' },
    ],
  },
  install: {
    name: 'install',
    description:
      'Fetch a skill from a Git repository, well-known domain, or the platform registry and install it locally. This is a read-only pull from the source. Agentver resolves the source, fetches the files, runs a security scan before anything touches disk, writes the skill to .agentver/skills/, connects it to all detected agents via symlinks, and records the source, version, and integrity hash in your manifest and lockfile. The skill is not published to the Agentver registry - use agentver publish for that.',
    usage: 'agentver install <source>',
    args: [
      {
        name: 'source',
        desc: 'Git URL, well-known domain, or short name (e.g. github.com/acme/skill)',
        required: true,
      },
    ],
    options: [
      { flag: '--agent <agent>', desc: 'Target a specific agent instead of auto-detecting' },
      { flag: '--global', desc: 'Install globally' },
      { flag: '--dry-run', desc: 'Show what would be installed without making changes' },
      { flag: '--path <path>', desc: 'Override placement path' },
      { flag: '--no-detect', desc: 'Skip agent auto-detection (requires --agent)' },
      { flag: '--skip-audit', desc: 'Skip the security scan' },
    ],
    examples: [
      {
        cmd: 'agentver install github.com/acme/deploy-checker',
        desc: 'Install from a GitHub repo',
      },
      {
        cmd: 'agentver install github.com/acme/skill --agent cursor',
        desc: 'Install for Cursor only',
      },
      {
        cmd: 'agentver install github.com/acme/skill --dry-run',
        desc: 'Preview without installing',
      },
    ],
    notes:
      'Install pulls from an external source into your local .agentver/ directory. It does not push anything to the Agentver registry. To publish your own skills, use agentver publish. To save changes to the platform, use agentver save.',
    related: [
      { name: 'list', why: 'See what you have installed' },
      { name: 'status', why: 'Check for updates or local changes' },
      { name: 'update', why: 'Update installed skills to latest versions' },
      { name: 'remove', why: 'Uninstall a skill' },
      { name: 'audit', why: 'Run a security scan manually' },
      { name: 'publish', why: 'Publish your own skills to the registry' },
    ],
  },
  remove: {
    name: 'remove',
    description: 'Remove an installed package and its associated files.',
    usage: 'agentver remove <name>',
    args: [{ name: 'name', desc: 'Package name to remove', required: true }],
    options: [{ flag: '--dry-run', desc: 'Show what would be removed without making changes' }],
    examples: [{ cmd: 'agentver remove deploy-checker', desc: 'Remove a skill' }],
    related: [
      { name: 'install', why: 'Install new skills' },
      { name: 'list', why: 'See what you have installed' },
    ],
  },
  list: {
    name: 'list',
    description: 'Show all installed packages with their versions, sources, and target agents.',
    usage: 'agentver list',
    options: [{ flag: '--json', desc: 'Output as JSON' }],
    examples: [
      { cmd: 'agentver list', desc: 'List installed packages' },
      { cmd: 'agentver list --json', desc: 'Output as JSON for scripting' },
    ],
    related: [
      { name: 'status', why: 'Check for updates and local changes' },
      { name: 'install', why: 'Install more skills' },
      { name: 'remove', why: 'Uninstall a skill' },
    ],
  },
  update: {
    name: 'update',
    description:
      'Update installed skills to their latest upstream version. Handles locally modified packages with merge strategies.',
    usage: 'agentver update [name]',
    args: [
      { name: 'name', desc: 'Specific skill to update (updates all if omitted)', required: false },
    ],
    options: [{ flag: '--dry-run', desc: 'Show what would be updated without making changes' }],
    examples: [
      { cmd: 'agentver update', desc: 'Update all skills' },
      { cmd: 'agentver update deploy-checker', desc: 'Update a specific skill' },
    ],
    related: [
      { name: 'status', why: 'Check which skills have updates available' },
      { name: 'diff', why: 'See what changed before updating' },
      { name: 'list', why: 'See all installed skills' },
    ],
  },
  status: {
    name: 'status',
    description:
      'Show the status of installed skills - whether they are up-to-date, locally modified, or have upstream updates available.',
    usage: 'agentver status',
    options: [
      { flag: '--offline', desc: 'Skip upstream checks' },
      { flag: '--json', desc: 'Output as JSON' },
    ],
    examples: [{ cmd: 'agentver status', desc: 'Check all skills' }],
    related: [
      { name: 'update', why: 'Update skills that have upstream changes' },
      { name: 'diff', why: 'See what changed locally or upstream' },
      { name: 'list', why: 'See all installed skills' },
      { name: 'sync', why: 'Push your installation state to the platform' },
    ],
    notes:
      'Status symbols: ✓ up-to-date, M locally modified, U upstream update available, MU both.',
  },
  search: {
    name: 'search',
    description:
      'Search for skills across the platform registry, skills.sh community index, and well-known domains.',
    usage: 'agentver search <query>',
    args: [{ name: 'query', desc: 'Search term', required: true }],
    options: [
      { flag: '--type <type>', desc: 'Filter by type: skill, agent, plugin, script, prompt' },
      { flag: '--source <source>', desc: 'Search source: platform, community, well-known, or all' },
    ],
    examples: [
      { cmd: 'agentver search deploy', desc: 'Search for deploy-related skills' },
      { cmd: 'agentver search deploy --type plugin', desc: 'Search for plugins only' },
    ],
    related: [{ name: 'install', why: 'Install a skill you found' }],
  },
  scan: {
    name: 'scan',
    description: 'Detect installed AI agents and discover skills/config files in a directory.',
    usage: 'agentver scan [path]',
    args: [
      { name: 'path', desc: 'Directory to scan (defaults to current directory)', required: false },
    ],
    examples: [
      { cmd: 'agentver scan', desc: 'Scan current directory' },
      { cmd: 'agentver scan ~/projects', desc: 'Scan a specific directory' },
    ],
    related: [
      { name: 'install', why: 'Install skills for your detected agents' },
      { name: 'list', why: 'See what is already installed' },
    ],
  },
  publish: {
    name: 'publish',
    description:
      'Publish a skill to the registry with an automatic security audit and semver validation.',
    usage: 'agentver publish [path]',
    args: [
      {
        name: 'path',
        desc: 'Path to skill directory (defaults to current directory)',
        required: false,
      },
    ],
    options: [
      {
        flag: '--version <semver>',
        desc: 'Version to publish (uses SKILL.md frontmatter if omitted)',
      },
      { flag: '--dry-run', desc: 'Validate without publishing' },
      { flag: '--skip-audit', desc: 'Skip security scan' },
      { flag: '--json', desc: 'Output as JSON' },
    ],
    examples: [
      { cmd: 'agentver publish', desc: 'Publish current skill' },
      { cmd: 'agentver publish --version 2.0.0', desc: 'Publish with explicit version' },
      { cmd: 'agentver publish --dry-run', desc: 'Validate without publishing' },
    ],
    related: [
      { name: 'init', why: 'Scaffold a new skill to publish' },
      { name: 'version', why: 'Manage version tags after publishing' },
      { name: 'save', why: 'Save working changes without a version tag' },
      { name: 'audit', why: 'Run a security scan before publishing' },
    ],
  },
  save: {
    name: 'save',
    description:
      'Commit local skill changes to the platform as a working version (no version tag).',
    usage: 'agentver save [message]',
    args: [{ name: 'message', desc: 'Commit message (optional)', required: false }],
    options: [
      { flag: '--path <path>', desc: 'Path to skill directory' },
      { flag: '--dry-run', desc: 'Show what would be saved without committing' },
      { flag: '--json', desc: 'Output as JSON' },
    ],
    examples: [{ cmd: 'agentver save "fix validation rules"', desc: 'Save with a message' }],
    notes: 'Requires platform connection (agentver login).',
    related: [
      { name: 'publish', why: 'Create a versioned release instead' },
      { name: 'draft', why: 'Work on a draft branch before saving' },
      { name: 'login', why: 'Connect to the platform first' },
    ],
  },
  version: {
    name: 'version',
    description: 'Create and list semantic version tags for published skills.',
    usage: 'agentver version <subcommand>',
    subcommands: [
      {
        name: 'create <semver>',
        desc: 'Create a version tag from the current commit',
        usage: 'agentver version create 1.0.0 --notes "Initial release"',
      },
      {
        name: 'list',
        desc: 'List all versions for the current skill',
        usage: 'agentver version list',
      },
    ],
    options: [
      { flag: '--notes <text>', desc: 'Release notes (create only)' },
      { flag: '--json', desc: 'Output as JSON' },
    ],
    examples: [
      { cmd: 'agentver version create 1.0.0', desc: 'Tag current commit as v1.0.0' },
      { cmd: 'agentver version list', desc: 'List all versions' },
    ],
    related: [
      { name: 'publish', why: 'Publish files and tag a version in one step' },
      { name: 'log', why: 'See the commit history behind versions' },
    ],
  },
  draft: {
    name: 'draft',
    description: 'Manage draft branches for skill development.',
    usage: 'agentver draft <subcommand>',
    subcommands: [
      {
        name: 'create <name>',
        desc: 'Create a new draft branch',
        usage: 'agentver draft create experiment',
      },
      { name: 'list', desc: 'List open drafts', usage: 'agentver draft list' },
      {
        name: 'switch <name>',
        desc: 'Switch to a draft branch',
        usage: 'agentver draft switch experiment',
      },
      { name: 'publish', desc: 'Merge current draft to main', usage: 'agentver draft publish' },
      { name: 'discard', desc: 'Delete current draft branch', usage: 'agentver draft discard' },
    ],
    options: [{ flag: '--json', desc: 'Output as JSON' }],
    examples: [
      { cmd: 'agentver draft create experiment', desc: 'Start a new draft' },
      { cmd: 'agentver draft publish', desc: 'Merge the current draft' },
    ],
    related: [
      { name: 'save', why: 'Commit changes to the current branch' },
      { name: 'publish', why: 'Publish a versioned release from a draft' },
      { name: 'diff', why: 'See what changed in your draft' },
    ],
  },
  log: {
    name: 'log',
    description: 'Show the commit history for a skill.',
    usage: 'agentver log [name]',
    args: [
      {
        name: 'name',
        desc: 'Skill name (resolved from current directory if omitted)',
        required: false,
      },
    ],
    options: [
      { flag: '--limit <n>', desc: 'Number of entries to show (default: 20)' },
      { flag: '--json', desc: 'Output as JSON' },
    ],
    examples: [
      { cmd: 'agentver log deploy-checker', desc: 'Show history for a skill' },
      { cmd: 'agentver log --limit 5', desc: 'Show last 5 commits' },
    ],
    related: [
      { name: 'version', why: 'See or create version tags' },
      { name: 'diff', why: 'See the actual changes between versions' },
    ],
  },
  diff: {
    name: 'diff',
    description:
      'Show the unified diff between your local version and the upstream version of a skill.',
    usage: 'agentver diff <name>',
    args: [{ name: 'name', desc: 'Package name', required: true }],
    examples: [{ cmd: 'agentver diff deploy-checker', desc: 'Show local vs upstream diff' }],
    related: [
      { name: 'status', why: 'See which skills have changes' },
      { name: 'update', why: 'Apply upstream changes' },
      { name: 'propose', why: 'Submit your local changes as a proposal' },
    ],
  },
  propose: {
    name: 'propose',
    description:
      'Create a change proposal from your local modifications, similar to a pull request.',
    usage: 'agentver propose <name> <title>',
    args: [
      { name: 'name', desc: 'Package name', required: true },
      { name: 'title', desc: 'Proposal title', required: true },
    ],
    examples: [
      {
        cmd: 'agentver propose deploy-checker "Improve error handling"',
        desc: 'Submit a proposal',
      },
    ],
    notes:
      'Requires platform connection (agentver login). Generates a patch from your local changes.',
    related: [
      { name: 'proposals', why: 'List and manage open proposals' },
      { name: 'diff', why: 'Preview your changes before proposing' },
      { name: 'login', why: 'Connect to the platform first' },
    ],
  },
  proposals: {
    name: 'proposals',
    description: 'List open change proposals.',
    usage: 'agentver proposals [name]',
    args: [{ name: 'name', desc: 'Filter by skill name (optional)', required: false }],
    examples: [
      { cmd: 'agentver proposals', desc: 'List all open proposals' },
      { cmd: 'agentver proposals deploy-checker', desc: 'List proposals for a specific skill' },
    ],
    related: [{ name: 'propose', why: 'Create a new proposal' }],
  },
  audit: {
    name: 'audit',
    description:
      'Run the built-in security scanner on installed skills or an arbitrary directory. Checks for dangerous commands, suspicious patterns, and known risks.',
    usage: 'agentver audit [name]',
    args: [{ name: 'name', desc: 'Specific skill to audit (optional)', required: false }],
    options: [
      { flag: '--path <path>', desc: 'Scan an arbitrary directory instead of installed skills' },
    ],
    examples: [
      { cmd: 'agentver audit', desc: 'Audit all installed skills' },
      { cmd: 'agentver audit deploy-checker', desc: 'Audit a specific skill' },
      { cmd: 'agentver audit --path ./my-skills/', desc: 'Audit a directory' },
    ],
    related: [
      { name: 'install', why: 'Audit runs automatically on install' },
      { name: 'publish', why: 'Audit runs automatically before publishing' },
    ],
  },
  sync: {
    name: 'sync',
    description:
      'Push your local installation state to the platform for tracking and team visibility.',
    usage: 'agentver sync',
    examples: [{ cmd: 'agentver sync', desc: 'Sync installation state' }],
    related: [
      { name: 'status', why: 'Check your local state before syncing' },
      { name: 'login', why: 'Connect to the platform first' },
    ],
    notes:
      'Requires platform connection (agentver login). Includes machine ID for device tracking.',
  },
  login: {
    name: 'login',
    description:
      'Authenticate with the Agentver platform using a secure browser-based flow or an API key.',
    usage: 'agentver login [url]',
    args: [{ name: 'url', desc: 'Platform URL (optional)', required: false }],
    options: [{ flag: '--token <key>', desc: 'API key for CI/CD authentication' }],
    examples: [
      { cmd: 'agentver login', desc: 'Sign in interactively' },
      { cmd: 'agentver login --token <api-key>', desc: 'Authenticate with an API key' },
    ],
    related: [
      { name: 'whoami', why: 'Check your auth state after logging in' },
      { name: 'logout', why: 'Log out when done' },
      { name: 'sync', why: 'Sync your installation state to the platform' },
    ],
  },
  logout: {
    name: 'logout',
    description: 'Log out from the Agentver platform and clear stored credentials.',
    usage: 'agentver logout',
    examples: [{ cmd: 'agentver logout', desc: 'Log out' }],
    related: [{ name: 'login', why: 'Log back in' }],
  },
  whoami: {
    name: 'whoami',
    description: 'Show your current authentication state, connected platform, and organisations.',
    usage: 'agentver whoami',
    examples: [{ cmd: 'agentver whoami', desc: 'Check auth state' }],
    related: [
      { name: 'login', why: 'Sign in or switch accounts' },
      { name: 'logout', why: 'Log out' },
    ],
  },
}

export function generateStaticParams() {
  return Object.keys(COMMANDS).map((slug) => ({ slug }))
}

export function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  return params.then(({ slug }) => {
    const cmd = COMMANDS[slug]
    return { title: cmd ? `agentver ${cmd.name}` : 'Not Found' }
  })
}

export default async function CliCommandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const cmd = COMMANDS[slug]
  if (!cmd) notFound()

  return (
    <article>
      <div className="flex items-center gap-3">
        <a href="/docs/cli" className="text-muted text-sm transition-colors hover:text-primary">
          CLI
        </a>
        <span className="text-muted-light">/</span>
        <h1 className="font-bold font-display text-2xl tracking-tight md:text-3xl">
          <code className="font-mono">agentver {cmd.name}</code>
        </h1>
      </div>

      <p className="mt-4 text-lg text-muted leading-relaxed">{cmd.description}</p>

      {/* Usage */}
      <section className="mt-8">
        <h2 className="font-display font-semibold text-lg tracking-tight">Usage</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
          <pre className="p-4 font-mono text-[13px] leading-[1.75]">
            <code>
              <span className="text-primary">$</span> {cmd.usage}
            </code>
          </pre>
        </div>
      </section>

      {/* Arguments */}
      {cmd.args && cmd.args.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display font-semibold text-lg tracking-tight">Arguments</h2>
          <div className="mt-3 space-y-2">
            {cmd.args.map((arg) => (
              <div
                key={arg.name}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface/50 p-3"
              >
                <code className="shrink-0 rounded bg-surface px-2 py-0.5 font-mono text-sm">
                  {arg.required ? `<${arg.name}>` : `[${arg.name}]`}
                </code>
                <span className="text-muted text-sm">{arg.desc}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Subcommands */}
      {cmd.subcommands && cmd.subcommands.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display font-semibold text-lg tracking-tight">Subcommands</h2>
          <div className="mt-3 space-y-2">
            {cmd.subcommands.map((sub) => (
              <div key={sub.name} className="rounded-lg border border-border bg-surface/50 p-3">
                <code className="font-medium font-mono text-foreground text-sm">
                  {cmd.name} {sub.name}
                </code>
                <p className="mt-1 text-muted text-sm">{sub.desc}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Options */}
      {cmd.options && cmd.options.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display font-semibold text-lg tracking-tight">Options</h2>
          <div className="mt-3 space-y-2">
            {cmd.options.map((opt) => (
              <div
                key={opt.flag}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface/50 p-3"
              >
                <code className="shrink-0 rounded bg-surface px-2 py-0.5 font-mono text-sm">
                  {opt.flag}
                </code>
                <span className="text-muted text-sm">{opt.desc}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Examples */}
      <section className="mt-8">
        <h2 className="font-display font-semibold text-lg tracking-tight">Examples</h2>
        <div className="mt-3 space-y-3">
          {cmd.examples.map((ex) => (
            <div key={ex.cmd}>
              <p className="mb-1 text-muted text-sm">{ex.desc}</p>
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                <pre className="p-4 font-mono text-[13px] leading-[1.75]">
                  <code>
                    <span className="text-primary">$</span> {ex.cmd}
                  </code>
                </pre>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Notes */}
      {cmd.notes && (
        <section className="mt-8 rounded-xl border border-primary/20 bg-primary-light p-4">
          <p className="text-sm leading-relaxed">
            <span className="font-medium text-primary">Note:</span> {cmd.notes}
          </p>
        </section>
      )}

      {/* Related commands */}
      {cmd.related && cmd.related.length > 0 && (
        <section className="mt-10 border-border border-t pt-8">
          <h2 className="font-display font-semibold text-lg tracking-tight">Related commands</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {cmd.related.map((r) => (
              <a
                key={r.name}
                href={`/docs/cli/${r.name}`}
                className="group flex items-start gap-3 rounded-lg border border-border bg-surface/50 p-3 transition-all hover:border-primary/30 hover:shadow-sm"
              >
                <code className="shrink-0 font-medium font-mono text-foreground text-sm group-hover:text-primary">
                  {r.name}
                </code>
                <span className="text-muted text-sm">{r.why}</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </article>
  )
}
