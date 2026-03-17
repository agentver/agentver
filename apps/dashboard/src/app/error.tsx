'use client'

import { Button } from '@agentver/ui/components/button'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center space-y-4">
      <div className="text-center">
        <h2 className="font-display font-semibold text-xl">Something went wrong</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          An unexpected error occurred. Please try again or contact support.
        </p>
      </div>
      <Button onClick={reset} variant="outline">
        Try again
      </Button>
    </div>
  )
}
