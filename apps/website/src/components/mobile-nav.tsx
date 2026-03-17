'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const NAV_LINKS: { href: string; label: string; external?: boolean }[] = [
  { href: '/features', label: 'Features' },
  { href: '/cli', label: 'CLI' },
  { href: '/desktop', label: 'Desktop' },
  { href: '/agents', label: 'Agents' },
  { href: 'https://app.agentver.com', label: 'Platform' },
  { href: '/docs', label: 'Docs' },
  { href: 'https://github.com/agentver/platform', label: 'GitHub', external: true },
]

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:text-foreground md:hidden"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
      >
        {open ? (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        ) : (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 8h16" />
            <path d="M4 16h16" />
          </svg>
        )}
      </button>

      {open &&
        mounted &&
        createPortal(
          <div className="fixed inset-x-0 top-[65px] bottom-0 z-[60] bg-background md:hidden">
            <nav className="flex flex-col gap-1 px-6 py-6">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-4 py-3 font-medium text-foreground text-lg transition-colors hover:bg-surface"
                  {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {link.label}
                </a>
              ))}
              <div className="mt-4 border-border border-t pt-4">
                <a
                  href="/docs/quickstart"
                  onClick={() => setOpen(false)}
                  className="block rounded-full bg-primary px-6 py-3 text-center font-medium text-sm text-white transition-colors hover:bg-primary-bright"
                >
                  Get started
                </a>
                <a
                  href="https://app.agentver.com/sign-up"
                  onClick={() => setOpen(false)}
                  className="mt-3 block rounded-full border border-border px-6 py-3 text-center font-medium text-muted text-sm transition-colors hover:border-foreground/20 hover:text-foreground"
                >
                  Sign up free
                </a>
              </div>
            </nav>
          </div>,
          document.body
        )}
    </>
  )
}
