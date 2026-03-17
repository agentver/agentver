import { cn } from '@agentver/ui-utils'
import { usePrerequisites } from '../hooks/usePrerequisites'
import type { SetupStep } from '../lib/prerequisites'
import { getGitInstallInstructions } from '../lib/prerequisites'

type SetupProps = { onComplete: () => void }
type StatusConfig = { icon: string; colour: string; label: string }

const statusConfig: Record<SetupStep['status'], StatusConfig> = {
  checking: { icon: '\u2026', colour: 'text-muted-foreground', label: 'Checking' },
  found: { icon: '\u2713', colour: 'text-green-500', label: 'Found' },
  missing: { icon: '\u2717', colour: 'text-destructive', label: 'Missing' },
  installing: { icon: '\u21bb', colour: 'text-primary', label: 'Installing' },
  installed: { icon: '\u2713', colour: 'text-green-500', label: 'Installed' },
  error: { icon: '!', colour: 'text-destructive', label: 'Error' },
}

const descriptions: Record<string, string> = {
  git: 'Version control \u2014 required for fetching skills from repositories',
  bun: 'JavaScript runtime \u2014 powers the Agentver CLI',
  cli: 'Command-line tool \u2014 manages your agent skills',
}

function formatGitInstructions(): string {
  const instructions = getGitInstallInstructions()
  return [
    'macOS:',
    `  ${instructions.macos.replace(/\n/g, '\n  ')}`,
    '',
    'Windows:',
    `  ${instructions.windows.replace(/\n/g, '\n  ')}`,
    '',
    'Linux:',
    `  ${instructions.linux.replace(/\n/g, '\n  ')}`,
  ].join('\n')
}

function ChecklistItem({
  step,
  onInstall,
  installDisabled = false,
  instructions,
  onRetry,
}: {
  step: SetupStep
  onInstall?: () => void
  installDisabled?: boolean
  instructions?: string
  onRetry?: () => void
}) {
  const config = statusConfig[step.status]
  const isAnimating = step.status === 'checking' || step.status === 'installing'
  const description = descriptions[step.id] ?? ''

  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <div className="flex items-start gap-3.5">
        <div
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-lg border-[1.5px] font-bold text-[0.85rem]',
            config.colour,
            isAnimating && 'animate-[pulse_1.5s_ease-in-out_infinite]'
          )}
          style={{ borderColor: 'currentColor' }}
        >
          {step.status === 'installing' ? (
            <span className="inline-block animate-[spin_1s_linear_infinite]">{config.icon}</span>
          ) : (
            config.icon
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-medium text-[0.95rem]">
              {step.label}
              {step.version && (
                <span className="font-mono font-normal text-muted-foreground text-xs">
                  {step.version}
                </span>
              )}
            </span>
            <span className={cn('font-medium text-xs tracking-wide', config.colour)}>
              {config.label}
            </span>
          </div>
          <p className="text-muted-foreground text-xs leading-snug">{description}</p>
        </div>
      </div>
      {step.status === 'missing' && instructions && (
        <div className="mt-3 pl-[2.625rem]">
          <p className="mb-1.5 text-muted-foreground text-xs">Installation instructions:</p>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-muted px-4 py-3 font-mono text-foreground text-xs leading-relaxed">
            {instructions}
          </pre>
        </div>
      )}
      {step.status === 'missing' && onInstall && (
        <div className="mt-3 flex items-center gap-3 pl-[2.625rem]">
          <button
            onClick={onInstall}
            disabled={installDisabled}
            className={cn(
              'cursor-pointer rounded-lg border-none bg-primary px-4 py-2 font-[inherit] font-medium text-primary-foreground text-xs transition-opacity',
              installDisabled && 'cursor-not-allowed opacity-40'
            )}
          >
            Install {step.label}
          </button>
          {installDisabled && (
            <span className="text-muted-foreground text-xs italic">
              Requires Bun to be installed first
            </span>
          )}
        </div>
      )}
      {step.status === 'error' && (
        <div className="mt-3 flex items-center gap-3 pl-[2.625rem]">
          {step.error && <p className="text-destructive text-xs leading-snug">{step.error}</p>}
          {onRetry && (
            <button
              onClick={onRetry}
              className="shrink-0 cursor-pointer rounded-lg border border-border bg-transparent px-3 py-1.5 font-[inherit] text-muted-foreground text-xs transition-colors hover:text-foreground"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function Setup({ onComplete }: SetupProps) {
  const { steps, ready, install, check } = usePrerequisites()
  const gitStep = steps.find((s) => s.id === 'git')
  const bunStep = steps.find((s) => s.id === 'bun')
  const bunReady = bunStep?.status === 'found' || bunStep?.status === 'installed'
  const gitInstructions = gitStep?.status === 'missing' ? formatGitInstructions() : undefined

  return (
    <div className="flex h-full items-center justify-center bg-background p-8">
      <div className="w-full max-w-[560px] animate-[fadeIn_0.4s_ease-out] rounded-2xl border border-border bg-card p-10">
        <div className="mb-8 flex items-start gap-4">
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            className="shrink-0 text-primary"
          >
            <rect width="40" height="40" rx="10" fill="currentColor" fillOpacity="0.15" />
            <path
              d="M12 28V16l8-6 8 6v12l-8 4-8-4z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              fill="none"
            />
            <path
              d="M20 22v6M12 16l8 6 8-6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <h1 className="mb-1 font-[family-name:var(--font-display)] font-semibold text-xl tracking-tight">
              Setting up Agentver...
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We need a few things installed before you can get started.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {steps.map((step) => (
            <ChecklistItem
              key={step.id}
              step={step}
              onInstall={step.id === 'git' ? undefined : () => install(step.id as 'bun' | 'cli')}
              installDisabled={step.id === 'cli' && !bunReady}
              instructions={step.id === 'git' ? gitInstructions : undefined}
              onRetry={() => check()}
            />
          ))}
        </div>

        {ready && (
          <div className="mt-6 flex animate-[fadeIn_0.3s_ease-out] flex-col gap-4">
            <div className="flex items-center gap-2 text-green-500 text-sm">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="9" stroke="#22c55e" strokeWidth="1.5" />
                <path
                  d="M6 10l3 3 5-5"
                  stroke="#22c55e"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>All prerequisites are installed. You&apos;re ready to go!</span>
            </div>
            <button
              onClick={onComplete}
              className="w-full cursor-pointer rounded-xl border-none bg-primary px-6 py-3 font-[inherit] font-medium text-[0.95rem] text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
            >
              Get Started
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
