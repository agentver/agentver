import type { Metadata } from 'next'
import { FadeIn } from '@/components/fade-in'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'Terms of service for Agentver. The CLI is MIT-licensed, the platform is AGPLv3. Both are open source.',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen">
      <TermsHero />
      <TermsContent />
    </div>
  )
}

function TermsHero() {
  return (
    <section className="pt-32 pb-20 md:pt-40 md:pb-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="animate-fade-up">
          <h1 className="font-bold font-display text-4xl leading-tight tracking-tight md:text-6xl">
            Terms of Service
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted leading-relaxed">
            Fair terms for an open-source project. The CLI is MIT-licensed and the platform is
            AGPLv3 — both are fully open source. A few extra rules keep things running smoothly for
            everyone.
          </p>
          <p className="mt-3 text-muted text-sm">Effective date: 15 March 2026</p>
        </div>
      </div>
    </section>
  )
}

function TermsContent() {
  return (
    <section className="pb-28 md:pb-36">
      <div className="mx-auto max-w-3xl px-6">
        <div className="space-y-12">
          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Agreement</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              By using Agentver &mdash; whether the open-source CLI or the platform at
              app.agentver.com &mdash; you agree to these terms. If you are using Agentver on behalf
              of an organisation, you are agreeing on their behalf and confirming you have the
              authority to do so. If you do not agree, please do not use the service.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">
              Open-source licences
            </h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              The Agentver CLI and its associated packages (shared, agent-definitions, mcp-server,
              github-action) are released under the MIT licence. The platform (dashboard, website,
              desktop app, database, and UI packages) is released under the GNU Affero General
              Public Licence v3 (AGPLv3). You are free to use, modify, self-host, and distribute
              both in accordance with their respective licences. The full licence texts are
              available in the{' '}
              <a
                href="https://github.com/agentver/agentver"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary transition-colors hover:text-primary-bright"
              >
                GitHub repository
              </a>
              . The CLI works entirely locally and does not require a platform account.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Platform terms</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              The Agentver platform (available at app.agentver.com or self-hosted) provides team
              collaboration features including organisations, change proposals, role-based access,
              import gateway, and audit logging. Use of the hosted cloud platform requires an
              account. You must provide accurate information when creating an account and keep your
              credentials secure. You are responsible for all activity under your account.
              Self-hosted instances are governed by the AGPLv3 licence.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">User content</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              You retain ownership of all skills, configurations, and other content you create and
              publish through Agentver. By publishing content publicly, you grant other users the
              right to view, fork, and use your published skills in accordance with any licence you
              specify. You are responsible for the content of skills you publish, including ensuring
              you have the right to share that content and that it does not violate any laws or
              third-party rights.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Acceptable use</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">You agree not to:</p>
            <ul className="mt-3 space-y-2 text-muted text-sm leading-relaxed">
              <li className="flex items-start gap-3">
                <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary" />
                Publish skills containing malware, backdoors, or malicious code
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary" />
                Attempt to circumvent security measures or access controls
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary" />
                Use the platform to distribute spam, phishing, or fraudulent content
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary" />
                Abuse the platform in ways that degrade the experience for other users
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary" />
                Publish content that infringes on intellectual property rights
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary" />
                Impersonate other users or organisations
              </li>
            </ul>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              Agentver may remove content that violates these guidelines and may suspend or
              terminate accounts for repeated or serious violations.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Security scanning</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              Agentver includes a built-in security scanner that checks skills for common threats
              such as dangerous commands, data exfiltration, and prompt injection. This scanning is
              provided as-is and on a best-effort basis. It does not guarantee that a skill is safe,
              and you should always review skills before using them in sensitive environments.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Billing</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              The Team tier is billed per seat on a monthly or annual basis. You can add or remove
              seats at any time. Annual plans are billed upfront. You may cancel your subscription
              at any time, and your access will continue until the end of the current billing
              period. We do not offer partial refunds for unused time within a billing period.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Termination</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              You may close your account at any time from your account settings. We may suspend or
              terminate your account if you violate these terms. Upon termination, your private
              skills will no longer be accessible through the platform, but you can export your data
              using the CLI before closing your account. Public skills that have been forked by
              other users may continue to exist in their namespaces.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Disclaimers</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              Agentver is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
              warranties of any kind, whether express or implied. The CLI is provided under the MIT
              licence and the platform under AGPLv3, both with no warranty. We do not guarantee that
              the hosted platform will be uninterrupted, error-free, or that all security threats
              will be detected by the scanner.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">
              Limitation of liability
            </h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              To the maximum extent permitted by law, Agentver and its contributors shall not be
              liable for any indirect, incidental, special, consequential, or punitive damages, or
              any loss of profits or revenue, whether incurred directly or indirectly, or any loss
              of data, use, goodwill, or other intangible losses resulting from your use of the
              service. Our total liability for any claim arising from these terms or the service
              shall not exceed the amount you paid us in the twelve months preceding the claim.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Governing law</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              These terms are governed by the laws of the Netherlands. Any disputes arising from
              these terms or your use of Agentver shall be subject to the exclusive jurisdiction of
              the courts in the Netherlands.
            </p>
          </FadeIn>

          <FadeIn>
            <h2 className="font-display font-semibold text-xl tracking-tight">Changes</h2>
            <p className="mt-4 text-muted text-sm leading-relaxed">
              We may update these terms from time to time. When we make significant changes, we will
              notify you via email or a prominent notice on the platform at least 30 days before the
              changes take effect. Your continued use of Agentver after the updated terms take
              effect constitutes acceptance of those terms.
            </p>
          </FadeIn>

          <FadeIn>
            <div className="rounded-xl border border-border bg-surface p-6">
              <h2 className="font-display font-semibold text-xl tracking-tight">Contact</h2>
              <p className="mt-3 text-muted text-sm leading-relaxed">
                Questions about these terms? Get in touch at{' '}
                <a
                  href="mailto:legal@agentver.com"
                  className="font-medium text-primary transition-colors hover:text-primary-bright"
                >
                  legal@agentver.com
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
