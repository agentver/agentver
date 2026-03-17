import { useEffect, useState } from 'react'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useAuth } from './hooks/useAuth'
import { usePrerequisites } from './hooks/usePrerequisites'
import { useSettings } from './hooks/useSettings'
import { useTheme } from './hooks/useTheme'
import { Setup } from './pages/Setup'

function LoadingScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-background">
      <div className="flex items-center justify-center">
        <svg
          width="48"
          height="48"
          viewBox="0 0 40 40"
          fill="none"
          className="animate-[spin_2s_linear_infinite] text-primary"
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
      </div>
      <p className="animate-[pulse_1.5s_ease-in-out_infinite] text-muted-foreground text-sm">
        Loading Agentver...
      </p>
    </div>
  )
}

export function App() {
  const { ready, checking } = usePrerequisites()
  const [setupComplete, setSetupComplete] = useState(false)
  const { settings } = useSettings()

  useTheme(settings.theme)

  const auth = useAuth()

  useEffect(() => {
    if (ready && !checking) {
      setSetupComplete(true)
    }
  }, [ready, checking])

  const content = (() => {
    if (checking || auth.isLoading) {
      return <LoadingScreen />
    }

    if (!setupComplete) {
      return <Setup onComplete={() => setSetupComplete(true)} />
    }

    return <AppShell auth={auth} />
  })()

  return <ErrorBoundary>{content}</ErrorBoundary>
}
