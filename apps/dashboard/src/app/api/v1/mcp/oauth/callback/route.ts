import { type ConnectedProvider, prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit/logger'
import { getSession } from '@/lib/auth/session'
import { encryptToken } from '@/lib/crypto/token-encryption'
import {
  exchangeOAuthCode,
  getOAuthProviderById,
  OAuthProviderError,
  OAuthTokenExchangeError,
} from '@/lib/mcp/oauth-providers'

const logger = createLogger('mcp:oauth-callback')

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Map MCP OAuth provider IDs to the ConnectedProvider enum values */
const PROVIDER_ID_TO_CONNECTED_PROVIDER: Record<string, ConnectedProvider> = {
  github: 'GITHUB',
  gitlab: 'GITLAB',
  google: 'GOOGLE',
  // Slack, Sentry etc. do not have corresponding ConnectedProvider values
  // and will be stored in the vault only (not as connected accounts)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OAuthCallbackState = {
  userId: string
  providerId: string
  organisationId?: string
  teamId?: string
  vaultKey?: string
  /** Where to redirect the user after the flow completes */
  returnTo?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodeState(raw: string): OAuthCallbackState | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8')
    const parsed: unknown = JSON.parse(decoded)

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('userId' in parsed) ||
      !('providerId' in parsed) ||
      typeof (parsed as Record<string, unknown>).userId !== 'string' ||
      typeof (parsed as Record<string, unknown>).providerId !== 'string'
    ) {
      return null
    }

    const state = parsed as Record<string, unknown>

    return {
      userId: state.userId as string,
      providerId: state.providerId as string,
      organisationId: typeof state.organisationId === 'string' ? state.organisationId : undefined,
      teamId: typeof state.teamId === 'string' ? state.teamId : undefined,
      vaultKey: typeof state.vaultKey === 'string' ? state.vaultKey : undefined,
      returnTo: typeof state.returnTo === 'string' ? state.returnTo : undefined,
    }
  } catch {
    return null
  }
}

function buildRedirectUrl(
  baseUrl: string,
  returnTo: string | undefined,
  params: URLSearchParams
): string {
  const target = returnTo ?? '/settings/mcp'
  // Only allow relative paths to prevent open-redirect attacks
  const safePath = target.startsWith('/') ? target : '/settings/mcp'
  return `${baseUrl}${safePath}?${params.toString()}`
}

function buildErrorHtml(title: string, message: string, baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fafafa}
.card{background:#fff;border-radius:8px;padding:2rem;box-shadow:0 1px 3px rgba(0,0,0,.1);max-width:420px;text-align:center}
h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#666;margin:0 0 1rem}
a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p>
<a href="${baseUrl}/settings/mcp">Return to settings</a></div></body></html>`
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'

  // --- Handle provider-side errors ---

  if (error) {
    logger.warn('MCP OAuth error returned by provider', { error, errorDescription })
    const params = new URLSearchParams({
      error: errorDescription ?? 'OAuth authorisation was denied by the provider',
    })
    return NextResponse.redirect(buildRedirectUrl(baseUrl, undefined, params))
  }

  if (!code || !stateParam) {
    logger.warn('MCP OAuth callback missing code or state')
    return new NextResponse(
      buildErrorHtml(
        'Missing parameters',
        'The OAuth callback is missing required parameters. Please try again.',
        baseUrl
      ),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  // --- Decode and validate state ---

  const state = decodeState(stateParam)
  if (!state) {
    logger.warn('MCP OAuth callback received invalid state')
    return new NextResponse(
      buildErrorHtml(
        'Invalid state',
        'The OAuth state parameter could not be decoded. Please try again.',
        baseUrl
      ),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  // Validate state from cookie (CSRF protection)
  const cookieStore = await cookies()
  const storedState = cookieStore.get('mcp_oauth_state')?.value

  if (!storedState || storedState !== stateParam) {
    logger.warn('MCP OAuth state mismatch', {
      providerId: state.providerId,
      hasStoredState: !!storedState,
    })
    const params = new URLSearchParams({ error: 'Invalid OAuth state. Please try again.' })
    return NextResponse.redirect(buildRedirectUrl(baseUrl, state.returnTo, params))
  }

  // Clear the state cookie
  cookieStore.delete('mcp_oauth_state')

  // --- Verify authentication ---

  const session = await getSession()

  if (!session?.user) {
    logger.warn('MCP OAuth callback reached without authentication', {
      providerId: state.providerId,
    })
    const params = new URLSearchParams({
      error: 'Not authenticated. Please sign in and try again.',
    })
    return NextResponse.redirect(buildRedirectUrl(baseUrl, state.returnTo, params))
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  })

  if (!dbUser) {
    const params = new URLSearchParams({ error: 'User account not found' })
    return NextResponse.redirect(buildRedirectUrl(baseUrl, state.returnTo, params))
  }

  // Ensure the authenticated user matches the state
  if (dbUser.id !== state.userId) {
    logger.warn('MCP OAuth callback user mismatch', {
      stateUserId: state.userId,
      authenticatedUserId: dbUser.id,
      providerId: state.providerId,
    })
    const params = new URLSearchParams({
      error: 'OAuth session does not match the authenticated user. Please try again.',
    })
    return NextResponse.redirect(buildRedirectUrl(baseUrl, state.returnTo, params))
  }

  // --- Resolve provider ---

  const provider = getOAuthProviderById(state.providerId)
  if (!provider) {
    logger.error('MCP OAuth callback for unknown provider', { providerId: state.providerId })
    const params = new URLSearchParams({ error: 'Unknown OAuth provider' })
    return NextResponse.redirect(buildRedirectUrl(baseUrl, state.returnTo, params))
  }

  // --- Exchange code for token ---

  const redirectUri = `${baseUrl}/api/v1/mcp/oauth/callback`

  try {
    const tokenResult = await exchangeOAuthCode({
      providerId: state.providerId,
      code,
      redirectUri,
    })

    // --- Store credential in vault ---

    const vaultKey = state.vaultKey ?? provider.credentialKey
    const encryptedValue = encryptToken(tokenResult.accessToken)

    if (state.organisationId) {
      // Verify organisation membership
      const membership = await prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: dbUser.id,
            organisationId: state.organisationId,
          },
        },
      })

      if (!membership) {
        logger.warn('MCP OAuth user not a member of target organisation', {
          userId: dbUser.id,
          organisationId: state.organisationId,
          providerId: state.providerId,
        })
        const params = new URLSearchParams({
          error: 'You are not a member of the target organisation',
        })
        return NextResponse.redirect(buildRedirectUrl(baseUrl, state.returnTo, params))
      }

      // Upsert into the vault
      const secret = await prisma.secretVault.upsert({
        where: {
          organisationId_teamId_key: {
            organisationId: state.organisationId,
            teamId: state.teamId ?? '',
            key: vaultKey,
          },
        },
        create: {
          organisationId: state.organisationId,
          teamId: state.teamId ?? null,
          key: vaultKey,
          description: `${provider.displayName} OAuth token (auto-acquired via MCP flow)`,
          encryptedValue,
          sharing: state.teamId ? 'TEAM' : 'ORG',
          lastRotatedAt: new Date(),
          expiresAt: tokenResult.expiresIn
            ? new Date(Date.now() + tokenResult.expiresIn * 1000)
            : null,
          createdById: dbUser.id,
        },
        update: {
          encryptedValue,
          lastRotatedAt: new Date(),
          expiresAt: tokenResult.expiresIn
            ? new Date(Date.now() + tokenResult.expiresIn * 1000)
            : null,
        },
        select: { id: true },
      })

      // Store refresh token separately if present
      if (tokenResult.refreshToken) {
        const refreshKey = `${vaultKey}-refresh-token`
        await prisma.secretVault.upsert({
          where: {
            organisationId_teamId_key: {
              organisationId: state.organisationId,
              teamId: state.teamId ?? '',
              key: refreshKey,
            },
          },
          create: {
            organisationId: state.organisationId,
            teamId: state.teamId ?? null,
            key: refreshKey,
            description: `${provider.displayName} OAuth refresh token (auto-acquired)`,
            encryptedValue: encryptToken(tokenResult.refreshToken),
            sharing: state.teamId ? 'TEAM' : 'ORG',
            lastRotatedAt: new Date(),
            createdById: dbUser.id,
          },
          update: {
            encryptedValue: encryptToken(tokenResult.refreshToken),
            lastRotatedAt: new Date(),
          },
          select: { id: true },
        })
      }

      logAudit({
        userId: dbUser.id,
        action: 'MCP_OAUTH_CREDENTIAL_STORED',
        resource: 'SecretVault',
        resourceId: secret.id,
        metadata: {
          providerId: state.providerId,
          credentialKey: vaultKey,
          organisationId: state.organisationId,
          teamId: state.teamId,
          hasRefreshToken: !!tokenResult.refreshToken,
        },
      })

      logger.info('MCP OAuth credential stored in vault', {
        userId: dbUser.id,
        providerId: state.providerId,
        credentialKey: vaultKey,
        organisationId: state.organisationId,
      })
    } else {
      // No organisation context — store as a personal connected account
      // if the provider maps to a ConnectedProvider enum value
      const connectedProvider = PROVIDER_ID_TO_CONNECTED_PROVIDER[state.providerId]

      if (connectedProvider) {
        await prisma.connectedAccount.upsert({
          where: {
            userId_provider: {
              userId: dbUser.id,
              provider: connectedProvider,
            },
          },
          update: {
            accessToken: encryptedValue,
            refreshToken: tokenResult.refreshToken
              ? encryptToken(tokenResult.refreshToken)
              : undefined,
            expiresAt: tokenResult.expiresIn
              ? new Date(Date.now() + tokenResult.expiresIn * 1000)
              : undefined,
            scopes: tokenResult.scope?.split(/[, ]+/).filter(Boolean) ?? [],
          },
          create: {
            userId: dbUser.id,
            provider: connectedProvider,
            accessToken: encryptedValue,
            providerAccountId: '',
            refreshToken: tokenResult.refreshToken ? encryptToken(tokenResult.refreshToken) : null,
            expiresAt: tokenResult.expiresIn
              ? new Date(Date.now() + tokenResult.expiresIn * 1000)
              : null,
            scopes: tokenResult.scope?.split(/[, ]+/).filter(Boolean) ?? [],
            metadata: {
              source: 'mcp-oauth',
              credentialKey: vaultKey,
            },
          },
        })

        logger.info('MCP OAuth credential stored as connected account', {
          userId: dbUser.id,
          providerId: state.providerId,
          credentialKey: vaultKey,
        })
      } else {
        logger.warn(
          'MCP OAuth credential acquired but no organisation context or connected provider mapping — token not persisted',
          {
            userId: dbUser.id,
            providerId: state.providerId,
            credentialKey: vaultKey,
          }
        )

        const params = new URLSearchParams({
          error: `${provider.displayName} credentials were acquired but could not be stored. Please provide an organisation context.`,
        })
        return NextResponse.redirect(buildRedirectUrl(baseUrl, state.returnTo, params))
      }

      logAudit({
        userId: dbUser.id,
        action: 'MCP_OAUTH_CREDENTIAL_STORED',
        resource: 'ConnectedAccount',
        metadata: {
          providerId: state.providerId,
          credentialKey: vaultKey,
          connectedProvider: connectedProvider ?? null,
          hasRefreshToken: !!tokenResult.refreshToken,
        },
      })

      logger.info('MCP OAuth credential stored', {
        userId: dbUser.id,
        providerId: state.providerId,
        credentialKey: vaultKey,
      })
    }

    const params = new URLSearchParams({
      success: `${provider.displayName} credentials acquired successfully`,
      provider: state.providerId,
    })
    return NextResponse.redirect(buildRedirectUrl(baseUrl, state.returnTo, params))
  } catch (err) {
    if (err instanceof OAuthProviderError) {
      logger.error('MCP OAuth provider error', {
        providerId: err.providerId,
        message: err.message,
      })
      const params = new URLSearchParams({
        error: `${provider.displayName} is not properly configured. Please contact support.`,
      })
      return NextResponse.redirect(buildRedirectUrl(baseUrl, state.returnTo, params))
    }

    if (err instanceof OAuthTokenExchangeError) {
      logger.error('MCP OAuth token exchange failed', {
        providerId: err.providerId,
        statusCode: err.statusCode,
        message: err.message,
      })
      const params = new URLSearchParams({
        error: `Failed to exchange authorisation code with ${provider.displayName}. Please try again.`,
      })
      return NextResponse.redirect(buildRedirectUrl(baseUrl, state.returnTo, params))
    }

    logger.error('MCP OAuth callback unexpected error', {
      providerId: state.providerId,
      error: err instanceof Error ? err.message : String(err),
    })

    const params = new URLSearchParams({
      error: `An unexpected error occurred while connecting ${provider.displayName}. Please try again.`,
    })
    return NextResponse.redirect(buildRedirectUrl(baseUrl, state.returnTo, params))
  }
}
