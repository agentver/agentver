import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { encryptToken } from '@/lib/crypto/token-encryption'

const logger = createLogger('auth:gitlab-callback')

type GitLabTokenResponse = {
  access_token: string
  token_type: string
  refresh_token: string
  expires_in: number
  scope: string
  created_at: number
  error?: string
  error_description?: string
}

type GitLabUserResponse = {
  id: number
  username: string
  name: string
  email: string | null
  avatar_url: string
}

async function exchangeCodeForToken(code: string): Promise<GitLabTokenResponse> {
  const clientId = process.env.GITLAB_CLIENT_ID
  const clientSecret = process.env.GITLAB_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('GitLab OAuth credentials not configured')
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const redirectUri = `${baseUrl}/api/auth/gitlab/callback`

  const response = await fetch('https://gitlab.com/oauth/token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })

  if (!response.ok) {
    throw new Error(`GitLab token exchange failed: ${response.status}`)
  }

  return response.json() as Promise<GitLabTokenResponse>
}

async function fetchGitLabUser(accessToken: string): Promise<GitLabUserResponse> {
  const response = await fetch('https://gitlab.com/api/v4/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`GitLab user fetch failed: ${response.status}`)
  }

  return response.json() as Promise<GitLabUserResponse>
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const redirectBase = `${baseUrl}/settings/connections`

  if (error) {
    logger.warn('GitLab OAuth error', { error })
    const params = new URLSearchParams({ error: 'GitLab authorisation was denied' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  if (!code || !state) {
    const params = new URLSearchParams({ error: 'Missing code or state parameter' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  // Validate state from cookie (CSRF protection)
  const cookieStore = await cookies()
  const storedState = cookieStore.get('gitlab_oauth_state')?.value

  if (!storedState || storedState !== state) {
    logger.warn('GitLab OAuth state mismatch', { storedState: !!storedState, state: !!state })
    const params = new URLSearchParams({ error: 'Invalid OAuth state. Please try again.' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  // Clear the state cookie
  cookieStore.delete('gitlab_oauth_state')

  // Verify the user is authenticated
  const session = await getSession()

  if (!session?.user) {
    const params = new URLSearchParams({ error: 'Not authenticated' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  })

  if (!dbUser) {
    const params = new URLSearchParams({ error: 'User account not found' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  try {
    // Exchange code for access token
    const tokenData = await exchangeCodeForToken(code)

    if (tokenData.error) {
      logger.error('GitLab token exchange error', {
        error: tokenData.error,
        description: tokenData.error_description,
      })
      const params = new URLSearchParams({
        error: tokenData.error_description ?? 'Failed to connect GitLab account',
      })
      return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
    }

    // Fetch user info from GitLab
    const glUser = await fetchGitLabUser(tokenData.access_token)

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000)

    // Upsert the connected account
    await prisma.connectedAccount.upsert({
      where: {
        userId_provider: {
          userId: dbUser.id,
          provider: 'GITLAB',
        },
      },
      update: {
        accessToken: encryptToken(tokenData.access_token),
        refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
        providerAccountId: String(glUser.id),
        expiresAt,
        scopes: tokenData.scope.split(' ').map((s) => s.trim()),
        metadata: {
          login: glUser.username,
          name: glUser.name,
          email: glUser.email,
          avatarUrl: glUser.avatar_url,
        },
      },
      create: {
        userId: dbUser.id,
        provider: 'GITLAB',
        accessToken: encryptToken(tokenData.access_token),
        refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
        providerAccountId: String(glUser.id),
        expiresAt,
        scopes: tokenData.scope.split(' ').map((s) => s.trim()),
        metadata: {
          login: glUser.username,
          name: glUser.name,
          email: glUser.email,
          avatarUrl: glUser.avatar_url,
        },
      },
    })

    logger.info('GitLab account connected', {
      userId: dbUser.id,
      gitlabUsername: glUser.username,
    })

    const params = new URLSearchParams({ success: 'GitLab account connected successfully' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  } catch (err) {
    logger.error('GitLab OAuth callback failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    const params = new URLSearchParams({
      error: 'Failed to connect GitLab account. Please try again.',
    })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }
}
