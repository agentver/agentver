import type { Metadata } from 'next'
import { FadeIn } from '@/components/fade-in'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How Agentver handles your data. The CLI and self-hosted platform work locally with no data collection. The cloud platform collects only what is needed for team features.',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <PrivacyHero />
      <PrivacyContent />
    </div>
  )
}

function PrivacyHero() {
  return (
    <section className="pt-32 pb-20 md:pt-40 md:pb-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="animate-fade-up">
          <h1 className="font-bold font-display text-4xl leading-tight tracking-tight md:text-6xl">
            Privacy Policy
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted leading-relaxed">
            We believe in transparency. This policy explains what data we collect, how we use it,
            and the choices you have. No surprises, no fine print.
          </p>
          <p className="mt-3 text-muted text-sm">Effective date: 15 March 2026</p>
        </div>
      </div>
    </section>
  )
}

function PrivacyContent() {
  return (
    <section className="pb-28 md:pb-36">
      <div className="mx-auto max-w-3xl px-6">
        <div className="space-y-12">
          <FadeIn>
            <div className="rounded-xl border border-border bg-surface p-6">
              <h2 className="font-display font-semibold text-xl tracking-tight">
                The short version
              </h2>
              <p className="mt-3 text-muted leading-relaxed">
                The Agentver CLI is open source and runs entirely on your machine. It does not phone
                home, collect telemetry, or send your data anywhere. Self-hosted platform instances
                keep all data on your infrastructure. The hosted cloud platform at app.agentver.com
                collects only what is needed to provide team collaboration features. We never sell
                your data.
              </p>
            </div>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">What we collect</h2>
            <div className="mt-4 space-y-4">
              <div>
                <h3 className="font-medium text-foreground">Account information</h3>
                <p className="mt-1 text-muted text-sm leading-relaxed">
                  When you create an account on the platform, we collect your name, email address,
                  and profile information provided through our authentication provider. This is used
                  to identify you within your team and to communicate with you about your account.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground">Usage data</h3>
                <p className="mt-1 text-muted text-sm leading-relaxed">
                  We collect basic usage data on the platform such as page views, feature usage, and
                  error reports. This helps us improve the product. We do not track your activity
                  outside of the platform.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground">Skill content</h3>
                <p className="mt-1 text-muted text-sm leading-relaxed">
                  Skills you publish to the platform are stored in Git repositories. Public skills
                  are visible to all users. Private skills are only accessible to you and your team
                  members with appropriate permissions.
                </p>
              </div>
            </div>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">How we use it</h2>
            <ul className="mt-4 space-y-2 text-muted text-sm leading-relaxed">
              <li className="flex items-start gap-3">
                <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary" />
                To provide and maintain team collaboration features
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary" />
                To authenticate you and manage access to your organisation
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary" />
                To send you important account notifications (not marketing)
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary" />
                To improve the platform based on aggregate usage patterns
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary" />
                To detect and prevent abuse or security threats
              </li>
            </ul>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">CLI vs Platform</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-background p-5">
                <h3 className="font-medium text-foreground">CLI (open source, MIT)</h3>
                <p className="mt-2 text-muted text-sm leading-relaxed">
                  Runs locally on your machine. No accounts, no telemetry, no network requests to
                  Agentver servers. Your skills, your data, your control. The source code is
                  publicly auditable on GitHub.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background p-5">
                <h3 className="font-medium text-foreground">
                  Self-hosted platform (open source, AGPLv3)
                </h3>
                <p className="mt-2 text-muted text-sm leading-relaxed">
                  All data stays on your infrastructure. No data is sent to Agentver. You control
                  storage, authentication, and access. The source code is publicly auditable on
                  GitHub.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background p-5">
                <h3 className="font-medium text-foreground">Cloud platform (app.agentver.com)</h3>
                <p className="mt-2 text-muted text-sm leading-relaxed">
                  Requires an account for team features. Collects account information and usage data
                  as described above. Skills published publicly are visible to all platform users.
                </p>
              </div>
            </div>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Data storage</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              Platform data is stored on secure, encrypted infrastructure. Skill content is stored
              in Git repositories with cryptographic integrity verification. We retain your data for
              as long as your account is active. When you delete your account, we remove your
              personal data within 30 days, though published public skills may remain available.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Cookies</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              The platform uses cookies for authentication and to remember your preferences. We do
              not use advertising cookies or tracking pixels. The cookies we set are strictly
              functional &mdash; they keep you signed in and remember settings like your preferred
              theme.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Third parties</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              Authentication is handled by a third-party identity provider to keep your credentials
              secure. We use standard infrastructure providers for hosting and data storage. We do
              not sell, rent, or share your personal data with third parties for their marketing
              purposes. We may share data if required by law or to protect our rights.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Your rights</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              You have the right to access, correct, or delete your personal data at any time. You
              can export your skills using the CLI. You can delete your account from your account
              settings, and we will remove your personal data within 30 days. If you are in the EU,
              you have additional rights under GDPR including data portability and the right to
              object to processing.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Changes</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              We may update this policy from time to time. When we make significant changes, we will
              notify you via email or a prominent notice on the platform. Your continued use of the
              platform after changes take effect constitutes acceptance of the updated policy.
            </p>
          </FadeIn>

          <FadeIn>
            <div className="rounded-xl border border-border bg-surface p-6">
              <h2 className="font-display font-semibold text-xl tracking-tight">Contact</h2>
              <p className="mt-3 text-muted text-sm leading-relaxed">
                Questions about this privacy policy or how we handle your data? Get in touch at{' '}
                <a
                  href="mailto:privacy@agentver.com"
                  className="font-medium text-primary transition-colors hover:text-primary-bright"
                >
                  privacy@agentver.com
                </a>
                .
              </p>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  )
}
