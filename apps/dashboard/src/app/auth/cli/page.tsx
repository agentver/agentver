import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { CliAuthForm } from './cli-auth-form'

type SearchParams = Promise<{
  code_challenge?: string
  state?: string
  redirect_uri?: string
}>

export default async function CliAuthPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const session = await getSession()

  if (!session?.user) {
    const currentUrl = `/auth/cli?code_challenge=${params.code_challenge ?? ''}&state=${params.state ?? ''}&redirect_uri=${encodeURIComponent(params.redirect_uri ?? '')}`
    redirect(`/sign-in?redirect_url=${encodeURIComponent(currentUrl)}`)
  }

  if (!params.code_challenge || !params.state || !params.redirect_uri) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          fontFamily: 'system-ui, sans-serif',
          background: '#0a0a0a',
          color: '#fafafa',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#ef4444', fontSize: '1.2rem' }}>
            Invalid request — missing required parameters.
          </p>
        </div>
      </div>
    )
  }

  return (
    <CliAuthForm
      userEmail={session.user.email ?? ''}
      userName={session.user.name ?? ''}
      codeChallenge={params.code_challenge}
      state={params.state}
      redirectUri={params.redirect_uri}
    />
  )
}
