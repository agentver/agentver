import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { encryptToken } from '@/lib/crypto/token-encryption'

const logger = createLogger('auth:microsoft-callback')

type MicrosoftTokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope: string
  error?: string
  error_description?: string
}

type MicrosoftUserResponse = {
  id: string
  displayName: string
  mail: string | null
  userPrincipalName: string
}

async function exchangeCodeForToken(code: string): Promise<MicrosoftTokenResponse> {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI

  if (!clientId || !clientSecret) {
    throw new Error('Microsoft OAuth credentials not configured')
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const resolvedRedirectUri = redirectUri ?? `${baseUrl}/api/auth/microsoft/callback`

  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
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
      scope: 'Files.Read.All offline_access User.Read',
    }),
  })

  if (!response.ok) {
    throw new Error(`Microsoft token exchange failed: ${response.status}`)
  }

  return response.json() as Promise<MicrosoftTokenResponse>
}

async function fetchMicrosoftUser(accessToken: string): Promise<MicrosoftUserResponse> {
  const response = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Microsoft user fetch failed: ${response.status}`)
  }

  return response.json() as Promise<MicrosoftUserResponse>
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const redirectBase = `${baseUrl}/settings/connections`

  if (error) {
    logger.warn('Microsoft OAuth error', { error })
    const params = new URLSearchParams({ error: 'Microsoft authorisation was denied' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  if (!code || !state) {
    const params = new URLSearchParams({ error: 'Missing code or state parameter' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  // Validate state from cookie (CSRF protection)
  const cookieStore = await cookies()
  const storedState = cookieStore.get('microsoft_oauth_state')?.value

  if (!storedState || storedState !== state) {
    logger.warn('Microsoft OAuth state mismatch', { storedState: !!storedState, state: !!state })
    const params = new URLSearchParams({ error: 'Invalid OAuth state. Please try again.' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  // Clear the state cookie
  cookieStore.delete('microsoft_oauth_state')

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
      logger.error('Microsoft token exchange error', {
        error: tokenData.error,
        description: tokenData.error_description,
      })
      const params = new URLSearchParams({
        error: tokenData.error_description ?? 'Failed to connect Microsoft account',
      })
      return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
    }

    // Fetch user info from Microsoft
    const msUser = await fetchMicrosoftUser(tokenData.access_token)

    // Microsoft scopes are space-separated
    const scopes = tokenData.scope ? tokenData.scope.split(' ').map((s) => s.trim()) : []

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000)

    // Upsert the connected account
    await prisma.connectedAccount.upsert({
      where: {
        userId_provider: {
          userId: dbUser.id,
          provider: 'MICROSOFT',
        },
      },
      update: {
        accessToken: encryptToken(tokenData.access_token),
        refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : undefined,
        providerAccountId: msUser.id,
        expiresAt,
        scopes,
        metadata: {
          login: msUser.mail ?? msUser.userPrincipalName,
          name: msUser.displayName,
          email: msUser.mail ?? msUser.userPrincipalName,
          avatarUrl: null,
        },
      },
      create: {
        userId: dbUser.id,
        provider: 'MICROSOFT',
        accessToken: encryptToken(tokenData.access_token),
        refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
        providerAccountId: msUser.id,
        expiresAt,
        scopes,
        metadata: {
          login: msUser.mail ?? msUser.userPrincipalName,
          name: msUser.displayName,
          email: msUser.mail ?? msUser.userPrincipalName,
          avatarUrl: null,
        },
      },
    })

    logger.info('Microsoft account connected', {
      userId: dbUser.id,
      microsoftUserId: msUser.id,
    })

    const params = new URLSearchParams({ success: 'OneDrive account connected successfully' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  } catch (err) {
    logger.error('Microsoft OAuth callback failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    const params = new URLSearchParams({
      error: 'Failed to connect Microsoft account. Please try again.',
    })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }
}
