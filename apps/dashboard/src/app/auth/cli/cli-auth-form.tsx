'use client'

import { useState } from 'react'
import { authoriseCli } from './actions'

type CliAuthFormProps = {
  userEmail: string
  userName: string
  codeChallenge: string
  state: string
  redirectUri: string
}

export function CliAuthForm({
  userEmail,
  userName,
  codeChallenge,
  state,
  redirectUri,
}: CliAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAuthorise = async () => {
    setIsLoading(true)
    setError(null)
    try {
      await authoriseCli({ codeChallenge, state, redirectUri })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorisation failed')
      setIsLoading(false)
    }
  }

  const handleDeny = () => {
    const url = new URL(redirectUri)
    url.searchParams.set('error', 'access_denied')
    url.searchParams.set('state', state)
    window.location.href = url.toString()
  }

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
      <div style={{ maxWidth: '400px', width: '100%', padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          Authorise Agentver CLI
        </h1>
        <p style={{ color: '#a1a1aa', marginBottom: '2rem' }}>
          The CLI is requesting access to your account as{' '}
          <strong style={{ color: '#fafafa' }}>{userName || userEmail}</strong>.
        </p>

        <div
          style={{
            background: '#18181b',
            borderRadius: '8px',
            padding: '1rem',
            marginBottom: '2rem',
            textAlign: 'left',
          }}
        >
          <p style={{ color: '#a1a1aa', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
            This will allow the CLI to:
          </p>
          <ul
            style={{
              color: '#fafafa',
              fontSize: '0.875rem',
              listStyle: 'none',
              padding: 0,
              margin: 0,
            }}
          >
            <li style={{ padding: '0.25rem 0' }}>Read and install skills</li>
            <li style={{ padding: '0.25rem 0' }}>Publish and manage your skills</li>
            <li style={{ padding: '0.25rem 0' }}>Sync installations to the platform</li>
          </ul>
        </div>

        {error && (
          <p style={{ color: '#ef4444', fontSize: '0.875rem', marginBottom: '1rem' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={handleDeny}
            disabled={isLoading}
            style={{
              flex: 1,
              padding: '0.75rem',
              borderRadius: '6px',
              border: '1px solid #27272a',
              background: 'transparent',
              color: '#a1a1aa',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Deny
          </button>
          <button
            type="button"
            onClick={handleAuthorise}
            disabled={isLoading}
            style={{
              flex: 1,
              padding: '0.75rem',
              borderRadius: '6px',
              border: 'none',
              background: '#fafafa',
              color: '#0a0a0a',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            {isLoading ? 'Authorising...' : 'Authorise'}
          </button>
        </div>
      </div>
    </div>
  )
}
