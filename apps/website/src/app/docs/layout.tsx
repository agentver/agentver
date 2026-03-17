import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: {
    default: 'Documentation',
    template: '%s | Agentver Docs',
  },
}

const SIDEBAR_ITEMS = [
  {
    title: 'Getting Started',
    items: [
      { href: '/docs', label: 'Introduction' },
      { href: '/docs/quickstart', label: 'Quickstart' },
    ],
  },
  {
    title: 'CLI',
    items: [
      { href: '/docs/cli', label: 'Overview' },
      { href: '/docs/cli/adopt', label: 'adopt' },
      { href: '/docs/cli/audit', label: 'audit' },
      { href: '/docs/cli/completion', label: 'completion' },
      { href: '/docs/cli/config', label: 'config' },
      { href: '/docs/cli/diff', label: 'diff' },
      { href: '/docs/cli/doctor', label: 'doctor' },
      { href: '/docs/cli/draft', label: 'draft' },
      { href: '/docs/cli/info', label: 'info' },
      { href: '/docs/cli/init', label: 'init' },
      { href: '/docs/cli/install', label: 'install' },
      { href: '/docs/cli/list', label: 'list' },
      { href: '/docs/cli/log', label: 'log' },
      { href: '/docs/cli/login', label: 'login' },
      { href: '/docs/cli/logout', label: 'logout' },
      { href: '/docs/cli/pin', label: 'pin' },
      { href: '/docs/cli/publish', label: 'publish' },
      { href: '/docs/cli/remove', label: 'remove' },
      { href: '/docs/cli/save', label: 'save' },
      { href: '/docs/cli/scan', label: 'scan' },
      { href: '/docs/cli/search', label: 'search' },
      { href: '/docs/cli/status', label: 'status' },
      { href: '/docs/cli/suggest', label: 'suggest' },
      { href: '/docs/cli/suggestions', label: 'suggestions' },
      { href: '/docs/cli/sync', label: 'sync' },
      { href: '/docs/cli/unpin', label: 'unpin' },
      { href: '/docs/cli/update', label: 'update' },
      { href: '/docs/cli/upgrade', label: 'upgrade' },
      { href: '/docs/cli/verify', label: 'verify' },
      { href: '/docs/cli/version', label: 'version' },
      { href: '/docs/cli/whoami', label: 'whoami' },
    ],
  },
  {
    title: 'Concepts',
    items: [
      { href: '/docs/skill-spec', label: 'Skill Spec' },
      { href: '/docs/package-types', label: 'Package Types' },
      { href: '/docs/agents', label: 'Agent Compatibility' },
      { href: '/docs/security', label: 'Security Scanner' },
    ],
  },
]

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pt-20">
      <div className="mx-auto flex max-w-6xl">
        <aside className="sticky top-20 hidden h-[calc(100vh-5rem)] w-64 shrink-0 overflow-y-auto border-border/60 border-r px-6 py-8 md:block">
          <nav className="space-y-6">
            {SIDEBAR_ITEMS.map((section) => (
              <div key={section.title}>
                <h3 className="font-medium text-foreground text-xs uppercase tracking-wider">
                  {section.title}
                </h3>
                <ul className="mt-2 space-y-1">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        className="block rounded-md px-3 py-1.5 text-muted text-sm transition-colors hover:bg-surface hover:text-foreground"
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 px-6 py-8 md:px-12">{children}</div>
      </div>
    </div>
  )
}
