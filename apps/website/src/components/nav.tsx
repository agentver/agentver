import { LogoWordmark } from '@/components/logo'
import { MobileNav } from '@/components/mobile-nav'

const NAV_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/cli', label: 'CLI' },
  { href: '/desktop', label: 'Desktop' },
  { href: '/agents', label: 'Agents' },
  { href: 'https://app.agentver.com', label: 'Platform' },
  { href: '/docs', label: 'Docs' },
]

export function Nav() {
  return (
    <nav className="fixed top-0 z-50 w-full border-border/60 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <LogoWordmark />

        <div className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-muted text-sm transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/agentver/agentver"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden text-muted transition-colors hover:text-foreground sm:block"
            aria-label="GitHub"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
            </svg>
          </a>
          <a
            href="https://app.agentver.com/sign-up"
            className="hidden rounded-full border border-border px-4 py-2 font-medium text-muted text-sm transition-colors hover:border-foreground/20 hover:text-foreground sm:block"
          >
            Sign up free
          </a>
          <a
            href="/docs/quickstart"
            className="hidden rounded-full bg-primary px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-primary-bright sm:block"
          >
            Get started
          </a>
          <MobileNav />
        </div>
      </div>
    </nav>
  )
}
