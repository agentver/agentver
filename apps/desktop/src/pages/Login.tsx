import { cn } from '@agentver/ui-utils'
import { useState } from 'react'
import { DEFAULT_PLATFORM_URL } from '../lib/config'

type LoginProps = {
  onAuthenticated: () => void
  onSkip: () => void
  signInWithAPIKey: (apiKey: string, platformUrl?: string) => Promise<void>
  isLoading: boolean
  error: string | null
}

export function Login({ onAuthenticated, onSkip, signInWithAPIKey, isLoading, error }: LoginProps) {
  const [apiKey, setApiKey] = useState('')
  const [platformUrl, setPlatformUrl] = useState(DEFAULT_PLATFORM_URL)
  const [showAdvanced, setShowAdvanced] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!apiKey.trim()) return
    try {
      const url = platformUrl.trim() || undefined
      await signInWithAPIKey(apiKey.trim(), url)
      onAuthenticated()
    } catch {
      /* Error handled by hook */
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-background p-8">
      <div className="w-full max-w-[480px] animate-[fadeIn_0.4s_ease-out] rounded-2xl border border-border bg-card p-10">
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
              Sign in to Agentver
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Connect your account to sync skills across machines and access team features.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="api-key"
              className="font-medium text-muted-foreground text-xs tracking-[0.01em]"
            >
              API Key
            </label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="av_key_..."
              autoFocus
              disabled={isLoading}
              className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 font-mono text-foreground text-sm outline-none transition-colors focus:border-primary"
            />
            <p className="text-muted-foreground text-xs">
              Get an API key from your{' '}
              <span
                className="cursor-pointer text-primary underline underline-offset-2"
                role="link"
                tabIndex={0}
                onClick={() => {
                  import('@tauri-apps/plugin-opener').then(({ openUrl }) =>
                    openUrl(`${platformUrl}/settings/api-keys`)
                  )
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter')
                    import('@tauri-apps/plugin-opener').then(({ openUrl }) =>
                      openUrl(`${platformUrl}/settings/api-keys`)
                    )
                }}
              >
                Agentver dashboard
              </span>
            </p>
          </div>

          <div className="-mt-1">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex cursor-pointer items-center gap-1.5 border-none bg-transparent py-1 font-[inherit] text-muted-foreground text-xs transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn('transition-transform', showAdvanced && 'rotate-90')}
              >
                <path d="M4.5 2.5l3.5 3.5-3.5 3.5" />
              </svg>
              <span>Advanced</span>
            </button>
          </div>

          {showAdvanced && (
            <div className="flex animate-[fadeIn_0.2s_ease-out] flex-col gap-1.5">
              <label
                htmlFor="platform-url"
                className="font-medium text-muted-foreground text-xs tracking-[0.01em]"
              >
                Platform URL
              </label>
              <input
                id="platform-url"
                type="url"
                value={platformUrl}
                onChange={(e) => setPlatformUrl(e.target.value)}
                placeholder="https://app.agentver.com"
                disabled={isLoading}
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 font-mono text-foreground text-sm outline-none transition-colors focus:border-primary"
              />
              <p className="text-muted-foreground text-xs">
                Change this if you&apos;re using a self-hosted instance.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3.5 py-2.5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                className="text-destructive"
              >
                <circle cx="8" cy="8" r="6.5" />
                <path d="M8 5v3.5M8 10.5v.5" />
              </svg>
              <span className="text-[0.825rem] text-destructive leading-snug">{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !apiKey.trim()}
            className={cn(
              'mt-1 w-full cursor-pointer rounded-xl border-none bg-primary px-6 py-3 font-[inherit] font-medium text-[0.95rem] text-primary-foreground shadow-lg shadow-primary/20 transition-all',
              (isLoading || !apiKey.trim()) && 'cursor-not-allowed opacity-50'
            )}
          >
            {isLoading ? (
              <span className="inline-block animate-[spin_1s_linear_infinite]">&#x21bb;</span>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-muted-foreground text-xs lowercase">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <button
          type="button"
          onClick={onSkip}
          className="w-full cursor-pointer rounded-xl border border-border bg-transparent px-6 py-2.5 font-[inherit] text-muted-foreground text-sm transition-colors hover:border-foreground/20 hover:text-foreground"
        >
          Continue without an account
        </button>

        <p className="mt-3 text-center text-[0.725rem] text-muted-foreground leading-relaxed">
          You can still install and manage skills locally. Sign in later from Settings to enable
          sync and team features.
        </p>
      </div>
    </div>
  )
}
