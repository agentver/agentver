'use client'

import { Button } from '@agentver/ui/components/button'
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import { LogoIcon } from '@agentver/ui/components/logo'
import Link from 'next/link'
import { useState } from 'react'
import { forgetPassword } from '@/lib/auth/client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const result = await forgetPassword({
      email,
      redirectTo: '/reset-password',
    })

    if (result.error) {
      setError(result.error.message ?? 'Something went wrong. Please try again.')
      setLoading(false)
      return
    }

    setSubmitted(true)
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <div className="flex animate-fade-up items-center gap-2.5">
        <LogoIcon className="h-9 w-auto text-primary" />
        <span className="font-display font-semibold text-foreground text-xl tracking-tight">
          agentver
        </span>
      </div>

      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8">
        <div className="flex flex-col items-center gap-2">
          <h1 className="font-semibold text-foreground text-lg">Forgot your password?</h1>
          <p className="text-center text-muted-foreground text-sm">
            Enter your email address and we&apos;ll send you a link to reset your password.
          </p>
        </div>

        {submitted ? (
          <div className="space-y-4">
            <p className="text-center text-muted-foreground text-sm">
              If an account exists with that email, we&apos;ve sent a reset link. Please check your
              inbox.
            </p>
            <Link href="/sign-in" className="block">
              <Button variant="outline" className="w-full">
                Back to sign in
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Sending\u2026' : 'Send reset link'}
            </Button>
          </form>
        )}

        {!submitted && (
          <p className="text-center text-muted-foreground text-sm">
            Remember your password?{' '}
            <Link
              href="/sign-in"
              className="text-foreground underline underline-offset-4 hover:text-muted-foreground"
            >
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
