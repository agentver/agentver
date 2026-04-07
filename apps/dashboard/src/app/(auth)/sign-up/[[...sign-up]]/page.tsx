'use client'

import { Button } from '@agentver/ui/components/button'
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import { LogoIcon } from '@agentver/ui/components/logo'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Suspense, useState } from 'react'
import { GitHubIcon } from '@/components/icons/github'
import { GoogleIcon } from '@/components/icons/google'
import { useSocialAuth } from '@/hooks/use-social-auth'
import { signUp } from '@/lib/auth/client'

function SignUpContent() {
  const router = useRouter()
  const { providers, socialLoading, handleSocial, error, setError, redirectUrl } =
    useSocialAuth('sign-up')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const result = await signUp.email({ email, password, name })

    if (result.error) {
      setError(result.error.message ?? 'Sign up failed')
      setLoading(false)
      return
    }

    router.push(redirectUrl)
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
          <h1 className="font-semibold text-foreground text-lg">Create your account</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              required
            />
          </div>
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
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating account\u2026' : 'Sign up'}
          </Button>
        </form>

        {providers !== null && (providers.github || providers.google) && (
          <div data-testid="social-section">
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-border border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or continue with</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {providers.github && (
                <Button
                  variant="outline"
                  onClick={() => handleSocial('github')}
                  disabled={socialLoading !== null}
                >
                  <GitHubIcon className="mr-2 h-4 w-4" />
                  {socialLoading === 'github' ? 'Connecting\u2026' : 'GitHub'}
                </Button>
              )}
              {providers.google && (
                <Button
                  variant="outline"
                  onClick={() => handleSocial('google')}
                  disabled={socialLoading !== null}
                >
                  <GoogleIcon className="mr-2 h-4 w-4" />
                  {socialLoading === 'google' ? 'Connecting\u2026' : 'Google'}
                </Button>
              )}
            </div>
          </div>
        )}

        <p className="text-center text-muted-foreground text-sm">
          Already have an account?{' '}
          <Link
            href="/sign-in"
            className="text-foreground underline underline-offset-4 hover:text-muted-foreground"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpContent />
    </Suspense>
  )
}
