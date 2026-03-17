import type { Metadata } from 'next'
import { FadeIn } from '@/components/fade-in'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Free for individuals. $4/seat for teams. Simple, transparent pricing.',
}

const TIERS = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'For individuals and open source',
    cta: 'Get started',
    ctaHref: '/docs/quickstart',
    ctaStyle: 'border border-border text-foreground hover:border-foreground/20',
    highlighted: false,
    features: [
      'Fully open-source platform',
      'Unlimited public skills',
      'Up to 5 private skills',
      'Install from any Git repo',
      '43+ agent support',
      'Built-in security scanner',
      'MCP server catalogue',
      'Well-known protocol support',
      'Community search (skills.sh)',
    ],
  },
  {
    name: 'Team',
    price: '$4',
    period: '/seat/month',
    description: 'For teams that manage and share AI skills together',
    cta: 'Start free trial',
    ctaHref: 'https://app.agentver.com/sign-up',
    ctaStyle:
      'bg-primary text-white shadow-lg shadow-primary/20 hover:bg-primary-bright hover:shadow-primary/30 hover:shadow-xl',
    highlighted: true,
    badge: '14-day free trial',
    features: [
      'Everything in Free, plus:',
      'Unlimited private skills',
      'Organisations & teams',
      'Role-based access (Owner/Admin/Member/Viewer)',
      'Change proposals & reviews',
      'Draft branches',
      'Fork & sync',
      'Collections',
      'Credential vault (AES-256-GCM encrypted)',
      'Bundles (packages + MCP servers + credentials)',
      'Import gateway (GitHub, GitLab, Bitbucket, Drive, OneDrive)',
      'Audit logging',
      'API key management',
      'Installation tracking',
      'Email support',
    ],
  },
]

const FAQ = [
  {
    q: 'Is the platform really free?',
    a: 'Yes — the entire platform is open source. The CLI packages are MIT-licensed and the platform is AGPLv3. You can self-host everything for free, or use our hosted cloud.',
  },
  {
    q: 'Is the desktop app free?',
    a: 'Yes. The desktop app uses the same open-source engine underneath. No account required for local skill management.',
  },
  {
    q: 'What counts as a seat?',
    a: 'Any user in your organisation who can read or write skills. Viewer access counts as a seat. External collaborators on public skills do not.',
  },
  {
    q: 'Can I self-host?',
    a: 'Yes — the entire platform is open source under AGPLv3. Run it locally with Docker Compose or deploy to your own infrastructure. The CLI works standalone with any Git host too.',
  },
  {
    q: 'What about open source and students?',
    a: 'Everything is open source — self-host the full platform for free. The cloud Free tier gives you unlimited public skills, 5 private skills, and the full desktop app. Contact us if you need more for an open-source organisation.',
  },
  {
    q: 'How does billing work?',
    a: 'Annual billing saves 20% ($4/seat vs $5/seat monthly). 14-day free trial, no credit card required. Cancel anytime.',
  },
]

export default function PricingPage() {
  return (
    <div className="min-h-screen">
      <PricingHero />
      <PricingCards />
      <PricingFaq />
    </div>
  )
}

function PricingHero() {
  return (
    <section className="pt-32 pb-8 md:pt-40 md:pb-12">
      <div className="mx-auto max-w-6xl px-6 text-center">
        <div className="animate-fade-up">
          <h1 className="font-bold font-display text-4xl tracking-tight md:text-6xl">
            Simple, transparent pricing
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-lg text-muted">
            The entire platform is open source. Self-host for free or use our cloud. When your team
            needs managed collaboration, plans start at $4/seat. No metered usage. No gotchas.
          </p>
        </div>
      </div>
    </section>
  )
}

function PricingCards() {
  return (
    <section className="py-12 md:py-16">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto grid max-w-3xl grid-cols-1 items-start gap-6 md:grid-cols-2">
          {TIERS.map((tier, i) => (
            <FadeIn key={tier.name} delay={i * 100}>
              <div
                className={`relative rounded-2xl border p-8 transition-shadow duration-300 ${
                  tier.highlighted
                    ? 'border-primary/40 bg-background shadow-primary/[0.06] shadow-xl'
                    : 'border-border bg-background hover:shadow-lg'
                }`}
              >
                {tier.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 font-medium text-white text-xs">
                    {tier.badge}
                  </div>
                )}

                <h3 className="font-display font-semibold text-xl">{tier.name}</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="font-bold font-display text-4xl tracking-tight">
                    {tier.price}
                  </span>
                  {tier.period && <span className="text-muted text-sm">{tier.period}</span>}
                </div>
                <p className="mt-2 text-muted text-sm">{tier.description}</p>

                <a
                  href={tier.ctaHref}
                  className={`mt-6 block rounded-full px-6 py-3 text-center font-medium text-sm transition-all ${tier.ctaStyle}`}
                >
                  {tier.cta}
                </a>

                <ul className="mt-8 space-y-3 border-border border-t pt-6">
                  {tier.features.map((feature, fi) => (
                    <li key={feature} className="flex items-start gap-3 text-sm">
                      {fi === 0 && feature.startsWith('Everything') ? (
                        <span className="font-medium text-foreground">{feature}</span>
                      ) : (
                        <>
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
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                          <span className="text-muted">{feature}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </FadeIn>
          ))}
        </div>

        <FadeIn delay={200}>
          <p className="mt-8 text-center text-muted text-sm">
            All prices in USD. Annual billing: $4/seat/month. Monthly billing: $5/seat/month.
          </p>
          <p className="mt-2 text-center text-muted text-sm">
            Free tier works entirely locally.{' '}
            <a
              href="https://app.agentver.com/sign-up"
              className="font-medium text-primary transition-colors hover:text-primary-bright"
            >
              Sign up for the platform
            </a>{' '}
            to unlock team features.
          </p>
        </FadeIn>
      </div>
    </section>
  )
}

function PricingFaq() {
  return (
    <section className="bg-surface py-28 md:py-36">
      <div className="mx-auto max-w-3xl px-6">
        <FadeIn>
          <h2 className="text-center font-display font-semibold text-3xl tracking-tight md:text-4xl">
            Frequently asked questions
          </h2>
        </FadeIn>

        <div className="mt-12 space-y-6">
          {FAQ.map((item, i) => (
            <FadeIn key={item.q} delay={i * 60}>
              <div className="rounded-xl border border-border bg-background p-6">
                <h3 className="font-display font-semibold tracking-tight">{item.q}</h3>
                <p className="mt-2 text-muted text-sm leading-relaxed">{item.a}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  )
}
