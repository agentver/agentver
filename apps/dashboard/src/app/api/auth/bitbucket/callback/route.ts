import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { encryptToken } from '@/lib/crypto/token-encryption'

const logger = createLogger('auth:bitbucket-callback')

type BitbucketTokenResponse = {
  access_token: string
  token_type: string
  refresh_token: string
  scopes: string
  expires_in: number
  error?: string
  error_description?: string
}

type BitbucketUserResponse = {
  uuid: string
  username: string
  display_name: string
  links: {
    avatar: { href: string }
  }
}

async function exchangeCodeForToken(code: string): Promise<BitbucketTokenResponse> {
  const clientId = process.env.BITBUCKET_CLIENT_ID
  const clientSecret = process.env.BITBUCKET_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Bitbucket OAuth credentials not configured')
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const redirectUri = `${baseUrl}/api/auth/bitbucket/callback`

  const response = await fetch('https://bitbucket.org/site/oauth2/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!response.ok) {
    throw new Error(`Bitbucket token exchange failed: ${response.status}`)
  }

  return response.json() as Promise<BitbucketTokenResponse>
}

async function fetchBitbucketUser(accessToken: string): Promise<BitbucketUserResponse> {
  const response = await fetch('https://api.bitbucket.org/2.0/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Bitbucket user fetch failed: ${response.status}`)
  }

  return response.json() as Promise<BitbucketUserResponse>
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  const redirectBase = `${baseUrl}/settings/connections`

  if (error) {
    logger.warn('Bitbucket OAuth error', { error })
    const params = new URLSearchParams({ error: 'Bitbucket authorisation was denied' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  if (!code || !state) {
    const params = new URLSearchParams({ error: 'Missing code or state parameter' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  // Validate state from cookie (CSRF protection)
  const cookieStore = await cookies()
  const storedState = cookieStore.get('bitbucket_oauth_state')?.value

  if (!storedState || storedState !== state) {
    logger.warn('Bitbucket OAuth state mismatch', { storedState: !!storedState, state: !!state })
    const params = new URLSearchParams({ error: 'Invalid OAuth state. Please try again.' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }

  // Clear the state cookie
  cookieStore.delete('bitbucket_oauth_state')

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
      logger.error('Bitbucket token exchange error', {
        error: tokenData.error,
        description: tokenData.error_description,
      })
      const params = new URLSearchParams({
        error: tokenData.error_description ?? 'Failed to connect Bitbucket account',
      })
      return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
    }

    // Fetch user info from Bitbucket
    const bbUser = await fetchBitbucketUser(tokenData.access_token)

    // Bitbucket scopes are space-separated
    const scopes = tokenData.scopes ? tokenData.scopes.split(' ').map((s) => s.trim()) : []

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000)

    // Upsert the connected account
    await prisma.connectedAccount.upsert({
      where: {
        userId_provider: {
          userId: dbUser.id,
          provider: 'BITBUCKET',
        },
      },
      update: {
        accessToken: encryptToken(tokenData.access_token),
        refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
        providerAccountId: bbUser.uuid,
        expiresAt,
        scopes,
        metadata: {
          username: bbUser.username,
          displayName: bbUser.display_name,
          avatarUrl: bbUser.links.avatar.href,
        },
      },
      create: {
        userId: dbUser.id,
        provider: 'BITBUCKET',
        accessToken: encryptToken(tokenData.access_token),
        refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
        providerAccountId: bbUser.uuid,
        expiresAt,
        scopes,
        metadata: {
          username: bbUser.username,
          displayName: bbUser.display_name,
          avatarUrl: bbUser.links.avatar.href,
        },
      },
    })

    logger.info('Bitbucket account connected', {
      userId: dbUser.id,
      bitbucketUsername: bbUser.username,
    })

    const params = new URLSearchParams({ success: 'Bitbucket account connected successfully' })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  } catch (err) {
    logger.error('Bitbucket OAuth callback failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    const params = new URLSearchParams({
      error: 'Failed to connect Bitbucket account. Please try again.',
    })
    return NextResponse.redirect(`${redirectBase}?${params.toString()}`)
  }
}
