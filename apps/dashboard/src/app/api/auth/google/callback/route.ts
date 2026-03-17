import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { encryptToken } from '@/lib/crypto/token-encryption'

const logger = createLogger('auth:google-callback')

type GoogleTokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope: string
  error?: string
  error_description?: string
}

type GoogleUserInfo = {
  sub: string
  name: string
  given_name?: string
  family_name?: string
  picture?: string
  email?: string
  email_verified?: boolean
}

async function exchangeCodeForToken(code: string): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured')
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const resolvedRedirectUri = redirectUri ?? `${baseUrl}/api/auth/google/callback`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: resolvedRedirectUri,
    }),
  })

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status}`)
  }

  return response.json() as Promise<GoogleTokenResponse>
}

async function fetchGoogleUser(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Google user fetch failed: ${response.status}`)
  }

  return response.json() as Promise<GoogleUserInfo>
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const redirectBase = `${baseUrl}/settings/connections`

  if (error) {
    logger.warn('Google OAuth error', { error })
    const params = new URLSearchParams({ error: 'Google authorisation was denied' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  if (!code || !state) {
    const params = new URLSearchParams({ error: 'Missing code or state parameter' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  // Validate state from cookie (CSRF protection)
  const cookieStore = await cookies()
  const storedState = cookieStore.get('google_oauth_state')?.value

  if (!storedState || storedState !== state) {
    logger.warn('Google OAuth state mismatch', { storedState: !!storedState, state: !!state })
    const params = new URLSearchParams({ error: 'Invalid OAuth state. Please try again.' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  // Clear the state cookie
  cookieStore.delete('google_oauth_state')

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
      logger.error('Google token exchange error', {
        error: tokenData.error,
        description: tokenData.error_description,
      })
      const params = new URLSearchParams({
        error: tokenData.error_description ?? 'Failed to connect Google account',
      })
      return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
    }

    // Fetch user info from Google
    const googleUser = await fetchGoogleUser(tokenData.access_token)

    // Google scopes are space-separated
    const scopes = tokenData.scope ? tokenData.scope.split(' ').map((s) => s.trim()) : []

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000)

    // Upsert the connected account
    await prisma.connectedAccount.upsert({
      where: {
        userId_provider: {
          userId: dbUser.id,
          provider: 'GOOGLE',
        },
      },
      update: {
        accessToken: encryptToken(tokenData.access_token),
        refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : undefined,
        providerAccountId: googleUser.sub,
        expiresAt,
        scopes,
        metadata: {
          login: googleUser.email ?? googleUser.name,
          name: googleUser.name,
          email: googleUser.email,
          avatarUrl: googleUser.picture,
        },
      },
      create: {
        userId: dbUser.id,
        provider: 'GOOGLE',
        accessToken: encryptToken(tokenData.access_token),
        refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
        providerAccountId: googleUser.sub,
        expiresAt,
        scopes,
        metadata: {
          login: googleUser.email ?? googleUser.name,
          name: googleUser.name,
          email: googleUser.email,
          avatarUrl: googleUser.picture,
        },
      },
    })

    logger.info('Google account connected', {
      userId: dbUser.id,
      googleSub: googleUser.sub,
    })

    const params = new URLSearchParams({ success: 'Google Drive account connected successfully' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  } catch (err) {
    logger.error('Google OAuth callback failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    const params = new URLSearchParams({
      error: 'Failed to connect Google account. Please try again.',
    })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }
}
