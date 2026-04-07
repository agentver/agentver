'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { SocialProviders } from '@/app/api/auth/providers/route'
import { signIn } from '@/lib/auth/client'
import { sanitiseRedirectUrl } from '@/lib/auth/redirect'

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'You cancelled the sign-in. Please try again.',
  server_error: 'Something went wrong. Please try again later.',
}

type SocialAuthContext = 'sign-in' | 'sign-up'

export function useSocialAuth(context: SocialAuthContext) {
  const searchParams = useSearchParams()
  const oauthError = searchParams.get('error')
  const redirectUrl = sanitiseRedirectUrl(searchParams.get('redirect_url'))
  const [error, setError] = useState<string | null>(null)
  const [socialLoading, setSocialLoading] = useState<'github' | 'google' | null>(null)
  const [providers, setProviders] = useState<SocialProviders | null>(null)

  useEffect(() => {
    fetch('/api/auth/providers')
      .then((res) => res.json())
      .then((data: SocialProviders) => setProviders(data))
      .catch(() => setProviders({ github: false, google: false }))
  }, [])

  useEffect(() => {
    if (oauthError) {
      const fallback =
        context === 'sign-up'
          ? 'Sign up failed. Please try again.'
          : 'Sign in failed. Please try again.'
      setError(OAUTH_ERROR_MESSAGES[oauthError] ?? fallback)
    }
  }, [oauthError, context])

  async function handleSocial(provider: 'github' | 'google') {
    setSocialLoading(provider)
    const result = await signIn.social({ provider, callbackURL: redirectUrl })
    if (result.error) {
      const label = context === 'sign-up' ? 'sign-up' : 'sign-in'
      setError(`Failed to start social ${label}. Please try again.`)
      setSocialLoading(null)
    }
  }

  const hasSocialProviders = providers !== null && (providers.github || providers.google)

  return {
    providers,
    socialLoading,
    hasSocialProviders,
    handleSocial,
    error,
    setError,
    redirectUrl,
  }
}
