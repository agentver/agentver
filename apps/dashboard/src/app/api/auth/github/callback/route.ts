import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { encryptToken } from '@/lib/crypto/token-encryption'

const logger = createLogger('auth:github-callback')

type GitHubTokenResponse = {
  access_token: string
  token_type: string
  scope: string
  error?: string
  error_description?: string
}

type GitHubUserResponse = {
  id: number
  login: string
  name: string | null
  email: string | null
  avatar_url: string
}

async function exchangeCodeForToken(code: string): Promise<GitHubTokenResponse> {
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('GitHub OAuth credentials not configured')
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const redirectUri = `${baseUrl}/api/auth/github/callback`

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`)
  }

  return response.json() as Promise<GitHubTokenResponse>
}

async function fetchGitHubUser(accessToken: string): Promise<GitHubUserResponse> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub user fetch failed: ${response.status}`)
  }

  return response.json() as Promise<GitHubUserResponse>
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const redirectBase = `${baseUrl}/settings/connections`

  if (error) {
    logger.warn('GitHub OAuth error', { error })
    const params = new URLSearchParams({ error: 'GitHub authorisation was denied' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  if (!code || !state) {
    const params = new URLSearchParams({ error: 'Missing code or state parameter' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  // Validate state from cookie (CSRF protection)
  const cookieStore = await cookies()
  const storedState = cookieStore.get('github_oauth_state')?.value

  if (!storedState || storedState !== state) {
    logger.warn('GitHub OAuth state mismatch', { storedState: !!storedState, state: !!state })
    const params = new URLSearchParams({ error: 'Invalid OAuth state. Please try again.' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  // Clear the state cookie
  cookieStore.delete('github_oauth_state')

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
      logger.error('GitHub token exchange error', {
        error: tokenData.error,
        description: tokenData.error_description,
      })
      const params = new URLSearchParams({
        error: tokenData.error_description ?? 'Failed to connect GitHub account',
      })
      return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
    }

    // Fetch user info from GitHub
    const ghUser = await fetchGitHubUser(tokenData.access_token)

    // Upsert the connected account
    await prisma.connectedAccount.upsert({
      where: {
        userId_provider: {
          userId: dbUser.id,
          provider: 'GITHUB',
        },
      },
      update: {
        accessToken: encryptToken(tokenData.access_token),
        providerAccountId: String(ghUser.id),
        scopes: tokenData.scope.split(',').map((s) => s.trim()),
        metadata: {
          login: ghUser.login,
          name: ghUser.name,
          email: ghUser.email,
          avatarUrl: ghUser.avatar_url,
        },
      },
      create: {
        userId: dbUser.id,
        provider: 'GITHUB',
        accessToken: encryptToken(tokenData.access_token),
        providerAccountId: String(ghUser.id),
        scopes: tokenData.scope.split(',').map((s) => s.trim()),
        metadata: {
          login: ghUser.login,
          name: ghUser.name,
          email: ghUser.email,
          avatarUrl: ghUser.avatar_url,
        },
      },
    })

    logger.info('GitHub account connected', {
      userId: dbUser.id,
      githubLogin: ghUser.login,
    })

    const params = new URLSearchParams({ success: 'GitHub account connected successfully' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  } catch (err) {
    logger.error('GitHub OAuth callback failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    const params = new URLSearchParams({
      error: 'Failed to connect GitHub account. Please try again.',
    })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }
}
