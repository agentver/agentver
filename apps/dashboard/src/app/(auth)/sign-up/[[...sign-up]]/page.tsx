'use client'

import { Button } from '@agentver/ui/components/button'
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import { LogoIcon } from '@agentver/ui/components/logo'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { signIn, signUp } from '@/lib/auth/client'

function SignUpContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectUrl = searchParams.get('redirect_url') ?? '/'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
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

  async function handleSocial(provider: 'github' | 'google') {
    await signIn.social({ provider, callbackURL: redirectUrl })
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

          {error && <p className="text-destructive text-sm">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating account\u2026' : 'Sign up'}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-border border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or continue with</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => handleSocial('github')}>
            GitHub
          </Button>
          <Button variant="outline" onClick={() => handleSocial('google')}>
            Google
          </Button>
        </div>

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
