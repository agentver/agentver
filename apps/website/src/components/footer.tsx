import { LogoWordmark } from '@/components/logo'

const PRODUCT_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/cli', label: 'CLI' },
  { href: '/desktop', label: 'Desktop' },
  { href: '/agents', label: 'Agents' },
]

const PLATFORM_LINKS = [
  { href: 'https://app.agentver.com', label: 'Dashboard' },
  { href: 'https://app.agentver.com/sign-up', label: 'Sign up free' },
  { href: '/pricing', label: 'Pricing' },
]

const DEVELOPER_LINKS: { href: string; label: string; external?: boolean }[] = [
  { href: '/docs', label: 'Documentation' },
  { href: '/docs/quickstart', label: 'Getting Started' },
  { href: '/docs/cli', label: 'CLI Reference' },
  { href: '/agents', label: 'Agent Compatibility' },
  { href: 'https://github.com/agentver/platform', label: 'GitHub', external: true },
]

const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
]

export function Footer() {
  return (
    <footer className="border-border/60 border-t bg-surface/50">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-5 md:gap-12">
          <div className="col-span-2 md:col-span-1">
            <LogoWordmark />
            <p className="mt-4 max-w-xs text-muted text-sm leading-relaxed">
              Open-source version control for AI agent skills. Manage, import, and share skills
              across 43+ AI agents — from the CLI, desktop app, or team platform.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-foreground text-sm">Product</h3>
            <ul className="mt-4 space-y-3">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-muted text-sm transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-foreground text-sm">Platform</h3>
            <ul className="mt-4 space-y-3">
              {PLATFORM_LINKS.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-muted text-sm transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-foreground text-sm">Developers</h3>
            <ul className="mt-4 space-y-3">
              {DEVELOPER_LINKS.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-muted text-sm transition-colors hover:text-foreground"
                    {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-foreground text-sm">Legal</h3>
            <ul className="mt-4 space-y-3">
              {LEGAL_LINKS.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-muted text-sm transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-border/60 border-t pt-8 sm:flex-row">
          <p className="text-muted-light text-xs">
            &copy; {new Date().getFullYear()} Agentver. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
