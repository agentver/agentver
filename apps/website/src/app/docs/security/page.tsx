import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Security Scanner' }

const CATEGORIES = [
  {
    name: 'Dangerous commands',
    severity: 'Critical',
    desc: 'Detects rm -rf, sudo, chmod 777, curl|bash, eval(), exec(), system() and similar destructive or arbitrary execution patterns.',
    colour: 'bg-red-100 text-red-700',
  },
  {
    name: 'Data exfiltration',
    severity: 'Critical',
    desc: 'Detects POST requests, fetch with body payloads, webhook.site, ngrok, requestbin, and other data exfiltration patterns.',
    colour: 'bg-red-100 text-red-700',
  },
  {
    name: 'Obfuscated code',
    severity: 'Medium',
    desc: 'Detects long base64 strings, hex escapes, String.fromCharCode, Unicode escape sequences, and other code obfuscation techniques.',
    colour: 'bg-amber-100 text-amber-700',
  },
  {
    name: 'Suspicious URLs',
    severity: 'Medium',
    desc: 'Detects pastebin links, Discord webhook URLs, URL shorteners (bit.ly, t.ly), and other suspicious remote resources.',
    colour: 'bg-amber-100 text-amber-700',
  },
  {
    name: 'Credential exposure',
    severity: 'High',
    desc: 'Detects process.env access, dynamic environment variable reading, and patterns that suggest credential harvesting.',
    colour: 'bg-orange-100 text-orange-700',
  },
  {
    name: 'Prompt injection',
    severity: 'High',
    desc: 'Detects patterns designed to override agent instructions, escape sandboxes, or manipulate agent behaviour.',
    colour: 'bg-orange-100 text-orange-700',
  },
  {
    name: 'Remote code execution',
    severity: 'Critical',
    desc: 'Detects wget, ftp, SSH tunnelling, and other patterns that enable remote code execution.',
    colour: 'bg-red-100 text-red-700',
  },
]

export default function SecurityPage() {
  return (
    <article>
      <h1 className="font-bold font-display text-3xl tracking-tight md:text-4xl">
        Security Scanner
      </h1>
      <p className="mt-4 text-lg text-muted leading-relaxed">
        Every skill installed through Agentver is automatically scanned for security risks before it
        touches your system. The scanner runs 28 pattern rules across 7 categories, with zero
        external dependencies.
      </p>

      <section className="mt-10">
        <h2 className="font-display font-semibold text-xl tracking-tight">How it works</h2>
        <ol className="mt-4 space-y-3 text-muted">
          <li className="flex gap-3">
            <span className="font-medium text-primary">1.</span> You run{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">
              agentver install
            </code>{' '}
            or{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">
              agentver audit
            </code>
          </li>
          <li className="flex gap-3">
            <span className="font-medium text-primary">2.</span> All files are scanned against 28
            pattern rules
          </li>
          <li className="flex gap-3">
            <span className="font-medium text-primary">3.</span> Issues are reported with severity
            levels and specific line numbers
          </li>
          <li className="flex gap-3">
            <span className="font-medium text-primary">4.</span> Critical/high severity issues block
            installation by default
          </li>
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="font-display font-semibold text-xl tracking-tight">Scan categories</h2>
        <div className="mt-4 space-y-3">
          {CATEGORIES.map((cat) => (
            <div key={cat.name} className="rounded-xl border border-border bg-background p-5">
              <div className="flex items-center gap-3">
                <h3 className="font-display font-semibold tracking-tight">{cat.name}</h3>
                <span className={`rounded-full px-2.5 py-0.5 font-medium text-xs ${cat.colour}`}>
                  {cat.severity}
                </span>
              </div>
              <p className="mt-2 text-muted text-sm leading-relaxed">{cat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display font-semibold text-xl tracking-tight">Verdicts</h2>
        <div className="mt-4 space-y-2">
          {[
            {
              verdict: 'PASS',
              desc: 'No issues found. Skill is safe to install.',
              colour: 'text-primary',
            },
            {
              verdict: 'WARN',
              desc: 'Medium severity issues found. Skill is installed with warnings.',
              colour: 'text-amber-600',
            },
            {
              verdict: 'BLOCK',
              desc: 'Critical or high severity issues found. Installation is blocked.',
              colour: 'text-red-600',
            },
          ].map((v) => (
            <div
              key={v.verdict}
              className="flex items-start gap-3 rounded-lg border border-border bg-surface/50 p-3"
            >
              <code className={`shrink-0 font-bold font-mono text-sm ${v.colour}`}>
                {v.verdict}
              </code>
              <span className="text-muted text-sm">{v.desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display font-semibold text-xl tracking-tight">Manual auditing</h2>
        <p className="mt-2 text-muted leading-relaxed">
          You can run the security scanner manually on any directory:
        </p>
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
          <pre className="p-4 font-mono text-[13px] leading-[1.75]">
            <code>
              <span className="text-primary">$</span> agentver audit --path ./my-skills/{'\n'}
              <span className="text-muted"> scanning 12 files across 3 skills...</span>
              {'\n'}
              <span className="text-primary"> ✓ deploy-checker PASS</span>
              {'\n'}
              <span className="text-primary"> ✓ code-reviewer PASS</span>
              {'\n'}
              <span className="text-amber-600"> ⚠ untrusted-skill WARN (2 issues)</span>
            </code>
          </pre>
        </div>
      </section>
    </article>
  )
}
