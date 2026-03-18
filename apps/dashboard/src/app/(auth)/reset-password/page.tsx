'use client'

import { Button } from '@agentver/ui/components/button'
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import { LogoIcon } from '@agentver/ui/components/logo'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { resetPassword } from '@/lib/auth/client'

export default function ResetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const tokenError = searchParams.get('error')

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isInvalidToken = tokenError === 'INVALID_TOKEN' || !token

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    const result = await resetPassword({
      newPassword,
      token: token!,
    })

    if (result.error) {
      setError(result.error.message ?? 'Failed to reset password. The link may have expired.')
      setLoading(false)
      return
    }

    router.push('/sign-in?reset=success')
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
        {isInvalidToken ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2">
              <h1 className="font-semibold text-foreground text-lg">Invalid or expired link</h1>
              <p className="text-center text-muted-foreground text-sm">
                This password reset link is invalid or has expired. Please request a new one.
              </p>
            </div>
            <Link href="/forgot-password" className="block">
              <Button className="w-full">Request new link</Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2">
              <h1 className="font-semibold text-foreground text-lg">Reset your password</h1>
              <p className="text-center text-muted-foreground text-sm">
                Enter your new password below.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  minLength={8}
                />
              </div>

              {error && <p className="text-destructive text-sm">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Resetting\u2026' : 'Reset password'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
