import { Component, type ErrorInfo, type ReactNode } from 'react'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
  error: Error | null
}

/**
 * Root-level error boundary for the desktop app.
 *
 * Catches errors thrown during React render/lifecycle methods and displays
 * a recovery UI instead of a blank white screen. Does NOT catch errors in
 * event handlers or async code — that's a React limitation by design.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to stderr for Tauri's dev tools — no external telemetry
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleRestart = () => {
    window.location.reload()
  }

  handleCopyError = async () => {
    const { error } = this.state
    if (!error) return

    const text = [error.message, error.stack].filter(Boolean).join('\n\n')

    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard API may fail in some contexts — silently ignore
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const { error } = this.state

    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-background px-8">
        <div className="flex items-center justify-center">
          <svg width="48" height="48" viewBox="0 0 40 40" fill="none" className="text-primary">
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
        </div>

        <div className="flex flex-col items-center gap-2">
          <h1 className="font-semibold text-foreground text-lg">Something went wrong</h1>
          {error?.message && (
            <pre className="max-w-md whitespace-pre-wrap break-words rounded-md border border-border bg-muted px-4 py-3 font-mono text-muted-foreground text-xs">
              {error.message}
            </pre>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={this.handleRestart}
            className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
          >
            Restart
          </button>
          <button
            type="button"
            onClick={this.handleCopyError}
            className="rounded-md border border-border bg-muted px-4 py-2 font-medium text-muted-foreground text-sm transition-colors hover:bg-muted/80"
          >
            Copy error
          </button>
        </div>
      </div>
    )
  }
}

export { ErrorBoundary }
