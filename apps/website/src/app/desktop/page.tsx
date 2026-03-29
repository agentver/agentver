import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { FadeIn } from '@/components/fade-in'
import { LogoIcon } from '@/components/logo'

export const metadata: Metadata = {
  title: 'Desktop',
  description:
    'Download the Agentver desktop app - search, install, update, and manage AI agent skills from a native app. Windows, macOS, Linux.',
}

type DetectedPlatform = 'macos-arm' | 'macos-intel' | 'windows' | 'linux' | 'unknown'

async function detectPlatform(): Promise<DetectedPlatform> {
  const headersList = await headers()
  const ua = (headersList.get('user-agent') ?? '').toLowerCase()
  if (ua.includes('mac')) return 'macos-arm' // Default to ARM for modern macOS
  if (ua.includes('win')) return 'windows'
  if (ua.includes('linux')) return 'linux'
  return 'unknown'
}

const LATEST_RELEASE = {
  version: '0.1.0',
  date: '2026-03-15',
  downloads: {
    'macos-arm': {
      label: 'macOS (Apple Silicon)',
      filename: 'Agentver_0.1.0_aarch64.dmg',
      size: '~8 MB',
      comingSoon: true,
    },
    'macos-intel': {
      label: 'macOS (Intel)',
      filename: 'Agentver_0.1.0_x64.dmg',
      size: '~8 MB',
      comingSoon: true,
    },
    windows: {
      label: 'Windows',
      filename: 'Agentver_0.1.0_x64-setup.exe',
      size: '~5 MB',
      comingSoon: true,
    },
    linux: {
      label: 'Linux (AppImage)',
      filename: 'Agentver_0.1.0_amd64.AppImage',
      size: '~8 MB',
      comingSoon: false,
    },
  },
} as const

type DownloadPlatform = keyof typeof LATEST_RELEASE.downloads

function downloadUrl(filename: string): string {
  return `https://github.com/agentver/agentver/releases/download/desktop-v${LATEST_RELEASE.version}/${filename}`
}

function isAvailable(platform: DownloadPlatform): boolean {
  return !LATEST_RELEASE.downloads[platform].comingSoon
}

const FEATURES = [
  {
    title: 'Skill browser',
    desc: 'Search the registry, filter by agent and package type, view details, and install with one click.',
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
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    ),
  },
  {
    title: 'Installed skills',
    desc: 'See everything installed. Check status, view diffs, update with a click. Colour-coded status badges.',
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
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <path d="m9 11 3 3L22 4" />
      </svg>
    ),
  },
  {
    title: 'Agent detection',
    desc: 'Automatically finds your installed agents - Claude Code, Cursor, Windsurf, and 40 more.',
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
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    title: 'Change proposals',
    desc: 'Review proposals with a visual diff viewer. Approve, request changes, or comment.',
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
        <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z" />
        <path d="M15 3v4a2 2 0 0 0 2 2h4" />
      </svg>
    ),
  },
  {
    title: 'Secure authentication',
    desc: 'Secure sign-in via your browser. Credentials stored safely in your system keychain.',
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
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    title: 'Auto-prerequisites',
    desc: 'Checks everything is set up on startup. Installs anything missing automatically.',
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
        <path d="M12 2v4" />
        <path d="m16.2 7.8 2.9-2.9" />
        <path d="M18 12h4" />
        <path d="m16.2 16.2 2.9 2.9" />
        <path d="M12 18v4" />
        <path d="m4.9 19.1 2.9-2.9" />
        <path d="M2 12h4" />
        <path d="m4.9 4.9 2.9 2.9" />
      </svg>
    ),
  },
]

const SYSTEM_REQUIREMENTS = [
  { platform: 'macOS', requirement: 'macOS 11+ (Big Sur or later)' },
  { platform: 'Windows', requirement: 'Windows 10+ (64-bit)' },
  { platform: 'Linux', requirement: 'Ubuntu 20.04+, Fedora 36+, or any distro with WebKitGTK 4.1' },
]

const INSTALL_INSTRUCTIONS: Record<string, { label: string; steps: string; comingSoon?: boolean }> =
  {
    macOS: {
      label: 'macOS',
      steps: 'Open the .dmg, drag Agentver to Applications',
      comingSoon: true,
    },
    Windows: {
      label: 'Windows',
      steps: 'Run the installer, follow the prompts',
      comingSoon: true,
    },
    Linux: {
      label: 'Linux',
      steps: 'Make the AppImage executable and run it:',
    },
  }

export default async function DesktopPage() {
  const detectedPlatform = await detectPlatform()

  return (
    <div className="min-h-screen">
      <DesktopHero detectedPlatform={detectedPlatform} />
      <DesktopFeatures />
      <TechDetails />
      <DownloadSection detectedPlatform={detectedPlatform} />
    </div>
  )
}

function DesktopHero({ detectedPlatform }: { detectedPlatform: DetectedPlatform }) {
  const canDownload = detectedPlatform !== 'unknown' && isAvailable(detectedPlatform)
  const primaryDownload = canDownload ? LATEST_RELEASE.downloads[detectedPlatform] : null
  const comingSoonPlatform =
    detectedPlatform !== 'unknown' && !isAvailable(detectedPlatform)
      ? LATEST_RELEASE.downloads[detectedPlatform]
      : null

  return (
    <section className="pt-32 pb-20 md:pt-40 md:pb-28">
      <div className="mx-auto max-w-6xl px-6 text-center">
        <div className="animate-fade-up">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-light px-4 py-1.5">
            <span className="font-mono text-primary text-xs">v{LATEST_RELEASE.version}</span>
          </div>
          <h1 className="font-bold font-display text-4xl leading-tight tracking-tight md:text-6xl">
            Agent skills,
            <br />
            <span className="text-primary">without the terminal</span>
          </h1>
          <p className="mx-auto mt-6 max-w-lg text-lg text-muted leading-relaxed">
            For those who prefer a GUI — search, install, update, and manage skills from a native
            desktop app. Same open-source engine as the CLI and platform. Your way.
          </p>
          {primaryDownload ? (
            <div className="mt-8 flex flex-col items-center gap-3">
              <a
                href={downloadUrl(primaryDownload.filename)}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 font-medium text-sm text-white shadow-lg shadow-primary/25 transition-all hover:bg-primary-bright hover:shadow-xl"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download for {primaryDownload.label}
              </a>
              <span className="text-muted text-xs">
                v{LATEST_RELEASE.version} &middot; {primaryDownload.size}
              </span>
            </div>
          ) : comingSoonPlatform ? (
            <div className="mt-8 flex flex-col items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-7 py-3.5 font-medium text-muted text-sm">
                {comingSoonPlatform.label} — coming soon
              </span>
              <a
                href="#downloads"
                className="text-primary text-xs transition-colors hover:text-primary-bright"
              >
                Linux available now &darr;
              </a>
            </div>
          ) : (
            <div className="mt-8">
              <a
                href="#downloads"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 font-medium text-sm text-white shadow-lg shadow-primary/25 transition-all hover:bg-primary-bright hover:shadow-xl"
              >
                View downloads
              </a>
            </div>
          )}
        </div>

        {/* Abstract app window mockup */}
        <div className="mx-auto mt-16 max-w-2xl animate-fade-up [animation-delay:300ms]">
          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-2xl shadow-foreground/[0.06]">
            <div className="flex items-center gap-3 border-border border-b bg-surface px-5 py-3">
              <div className="flex gap-1.5">
                <span className="size-3 rounded-full bg-[oklch(0.70_0.15_25)]" />
                <span className="size-3 rounded-full bg-[oklch(0.75_0.12_85)]" />
                <span className="size-3 rounded-full bg-primary" />
              </div>
              <span className="font-mono text-muted text-xs">Agentver Desktop</span>
            </div>
            <div className="p-8">
              <div className="flex items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  className="text-muted"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <span className="text-muted text-sm">Search skills, plugins, configs...</span>
              </div>
              <div className="mt-6 grid grid-cols-3 gap-3">
                {['deploy-checker', 'code-reviewer', 'test-writer'].map((skill) => (
                  <div key={skill} className="rounded-lg border border-border bg-surface p-4">
                    <div className="mb-2 inline-block rounded bg-primary-light px-2 py-0.5 font-mono text-[10px] text-primary">
                      skill
                    </div>
                    <div className="font-medium text-foreground text-sm">{skill}</div>
                    <div className="mt-1 text-muted text-xs">v2.1.0</div>
                    <div className="mt-3 rounded-md bg-primary-light py-1.5 text-center font-medium text-primary text-xs">
                      Install
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="size-2 rounded-full bg-primary" />
                  <span className="text-foreground text-sm">3 agents detected</span>
                </div>
                <span className="text-muted text-xs">Claude Code, Cursor, Windsurf</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function DesktopFeatures() {
  return (
    <section className="py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <FadeIn>
          <h2 className="text-center font-display font-semibold text-3xl tracking-tight md:text-4xl">
            Everything the CLI does, in a GUI
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-lg text-muted">
            Same open-source engine as the CLI - just wrapped in a native interface that feels right
            at home on your machine.
          </p>
        </FadeIn>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <FadeIn key={feature.title} delay={i * 80}>
              <div className="group rounded-2xl border border-border bg-background p-7 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/[0.04]">
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary-light text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-white">
                  {feature.icon}
                </div>
                <h3 className="mt-5 font-display font-semibold tracking-tight">{feature.title}</h3>
                <p className="mt-2 text-muted text-sm leading-relaxed">{feature.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}

function TechDetails() {
  return (
    <section className="bg-surface py-20">
      <div className="mx-auto max-w-4xl px-6">
        <FadeIn>
          <div className="grid gap-8 md:grid-cols-3">
            {[
              { stat: '~3 MB', label: 'Installer size', sub: 'Lightweight and fast' },
              { stat: '<500ms', label: 'Startup time', sub: 'Native performance' },
              { stat: '~40 MB', label: 'Memory usage', sub: 'Easy on your machine' },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <div className="font-bold font-display text-3xl text-primary tracking-tight">
                  {item.stat}
                </div>
                <div className="mt-1 font-medium text-foreground text-sm">{item.label}</div>
                <div className="mt-0.5 text-muted text-xs">{item.sub}</div>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  )
}

function DownloadSection({
  detectedPlatform: _detectedPlatform,
}: {
  detectedPlatform: DetectedPlatform
}) {
  const linuxDownload = LATEST_RELEASE.downloads.linux
  const allPlatforms = Object.entries(LATEST_RELEASE.downloads) as [
    DownloadPlatform,
    (typeof LATEST_RELEASE.downloads)[DownloadPlatform],
  ][]

  return (
    <section id="downloads" className="bg-dark-bg py-28 md:py-36">
      <div className="mx-auto max-w-4xl px-6">
        <FadeIn>
          <div className="text-center">
            <LogoIcon className="mx-auto h-14 w-auto text-primary" />
            <h2 className="mt-6 font-display font-semibold text-3xl text-dark-text tracking-tight md:text-4xl">
              Download Agentver Desktop
            </h2>
            <p className="mx-auto mt-4 max-w-md text-dark-muted leading-relaxed">
              Currently available for Linux. macOS and Windows coming soon.
            </p>

            {/* Primary download — always Linux for now */}
            <div className="mt-10 flex flex-col items-center gap-3">
              <a
                href={downloadUrl(linuxDownload.filename)}
                className="inline-flex items-center gap-2.5 rounded-full bg-primary px-8 py-4 font-medium text-white shadow-lg shadow-primary/25 transition-all hover:bg-primary-bright hover:shadow-xl"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download for {linuxDownload.label}
              </a>
              <span className="text-dark-muted text-xs">
                v{LATEST_RELEASE.version} &middot; {linuxDownload.size}
              </span>
            </div>
          </div>
        </FadeIn>

        {/* All platforms */}
        <FadeIn delay={100}>
          <div className="mt-16">
            <h3 className="mb-6 text-center font-mono text-dark-muted text-xs uppercase tracking-wider">
              All platforms
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {allPlatforms.map(([key, download]) => {
                const available = isAvailable(key)
                return available ? (
                  <a
                    key={key}
                    href={downloadUrl(download.filename)}
                    className="group flex items-center justify-between rounded-xl border border-dark-border bg-dark-surface px-5 py-4 transition-all hover:border-primary/40 hover:shadow-lg"
                  >
                    <div>
                      <div className="font-medium text-dark-text text-sm group-hover:text-primary">
                        {download.label}
                      </div>
                      <div className="mt-0.5 font-mono text-dark-muted text-xs">
                        {download.filename}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-dark-muted text-xs">
                      <span>{download.size}</span>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="group-hover:text-primary"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </div>
                  </a>
                ) : (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-xl border border-dark-border bg-dark-surface px-5 py-4 opacity-60"
                  >
                    <div>
                      <div className="font-medium text-dark-text text-sm">{download.label}</div>
                      <div className="mt-0.5 text-dark-muted text-xs">Coming soon</div>
                    </div>
                    <span className="rounded-full border border-dark-border px-2.5 py-0.5 font-mono text-[10px] text-dark-muted">
                      Soon
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </FadeIn>

        {/* Installation instructions */}
        <FadeIn delay={200}>
          <div className="mt-16">
            <h3 className="mb-6 text-center font-mono text-dark-muted text-xs uppercase tracking-wider">
              Installation
            </h3>
            <div className="grid gap-4 md:grid-cols-3">
              {Object.entries(INSTALL_INSTRUCTIONS).map(([key, instruction]) => (
                <div
                  key={key}
                  className={`rounded-xl border border-dark-border bg-dark-surface p-5${instruction.comingSoon ? 'opacity-60' : ''}`}
                >
                  <div className="mb-3 flex items-center gap-2 font-medium text-dark-text text-sm">
                    {instruction.label}
                    {instruction.comingSoon && (
                      <span className="rounded-full border border-dark-border px-2 py-0.5 font-mono text-[10px] text-dark-muted">
                        Soon
                      </span>
                    )}
                  </div>
                  {instruction.comingSoon ? (
                    <p className="text-dark-muted text-xs leading-relaxed">Coming soon</p>
                  ) : (
                    <>
                      <p className="text-dark-muted text-xs leading-relaxed">{instruction.steps}</p>
                      {key === 'Linux' && (
                        <code className="mt-2 block rounded-lg bg-dark-bg px-3 py-2 font-mono text-[11px] text-dark-muted leading-relaxed">
                          chmod +x Agentver*.AppImage && ./Agentver*.AppImage
                        </code>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* System requirements */}
        <FadeIn delay={300}>
          <div className="mt-16">
            <h3 className="mb-6 text-center font-mono text-dark-muted text-xs uppercase tracking-wider">
              System requirements
            </h3>
            <div className="overflow-hidden rounded-xl border border-dark-border">
              {SYSTEM_REQUIREMENTS.map((req, i) => (
                <div
                  key={req.platform}
                  className={`flex items-center justify-between px-5 py-3.5 ${
                    i < SYSTEM_REQUIREMENTS.length - 1 ? 'border-dark-border border-b' : ''
                  }`}
                >
                  <span className="font-medium text-dark-text text-sm">{req.platform}</span>
                  <span className="text-dark-muted text-xs">{req.requirement}</span>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* CLI fallback */}
        <FadeIn delay={400}>
          <div className="mt-12 text-center">
            <a
              href="/cli"
              className="font-medium text-dark-muted text-sm transition-colors hover:text-dark-text"
            >
              Prefer the terminal? Use the CLI instead &rarr;
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
