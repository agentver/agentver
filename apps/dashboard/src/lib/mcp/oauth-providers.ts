import { createLogger } from '@agentver/shared'

const logger = createLogger('mcp:oauth-providers')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OAuthProviderConfig = {
  /** Provider identifier matching MCP credential keys */
  providerId: string
  /** Human-readable name */
  displayName: string
  /** OAuth authorisation URL */
  authoriseUrl: string
  /** OAuth token exchange URL */
  tokenUrl: string
  /** Environment variable names for client ID and secret */
  clientIdEnv: string
  clientSecretEnv: string
  /** Default scopes for MCP usage */
  defaultScopes: string[]
  /** Maps the OAuth token to the MCP credential key */
  credentialKey: string
  /** Token type returned (usually 'bearer') */
  tokenType: string
}

export type OAuthTokenResult = {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  tokenType: string
  scope?: string
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OAuthProviderError extends Error {
  public readonly providerId: string

  constructor(message: string, providerId: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'OAuthProviderError'
    this.providerId = providerId
  }
}

export class OAuthTokenExchangeError extends Error {
  public readonly providerId: string
  public readonly statusCode: number | undefined

  constructor(message: string, providerId: string, statusCode?: number, options?: ErrorOptions) {
    super(message, options)
    this.name = 'OAuthTokenExchangeError'
    this.providerId = providerId
    this.statusCode = statusCode
  }
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const OAUTH_PROVIDERS: ReadonlyArray<OAuthProviderConfig> = [
  {
    providerId: 'github',
    displayName: 'GitHub',
    authoriseUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientIdEnv: 'MCP_GITHUB_CLIENT_ID',
    clientSecretEnv: 'MCP_GITHUB_CLIENT_SECRET',
    defaultScopes: ['repo', 'read:user'],
    credentialKey: 'GITHUB_PERSONAL_ACCESS_TOKEN',
    tokenType: 'bearer',
  },
  {
    providerId: 'gitlab',
    displayName: 'GitLab',
    authoriseUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    clientIdEnv: 'MCP_GITLAB_CLIENT_ID',
    clientSecretEnv: 'MCP_GITLAB_CLIENT_SECRET',
    defaultScopes: ['read_api', 'read_repository'],
    credentialKey: 'GITLAB_PERSONAL_ACCESS_TOKEN',
    tokenType: 'bearer',
  },
  {
    providerId: 'google',
    displayName: 'Google',
    authoriseUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'MCP_GOOGLE_CLIENT_ID',
    clientSecretEnv: 'MCP_GOOGLE_CLIENT_SECRET',
    defaultScopes: [],
    credentialKey: 'GOOGLE_API_KEY',
    tokenType: 'bearer',
  },
  {
    providerId: 'slack',
    displayName: 'Slack',
    authoriseUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientIdEnv: 'MCP_SLACK_CLIENT_ID',
    clientSecretEnv: 'MCP_SLACK_CLIENT_SECRET',
    defaultScopes: ['channels:read', 'chat:write', 'users:read'],
    credentialKey: 'SLACK_BOT_TOKEN',
    tokenType: 'bearer',
  },
  {
    providerId: 'sentry',
    displayName: 'Sentry',
    authoriseUrl: 'https://sentry.io/oauth/authorize/',
    tokenUrl: 'https://sentry.io/oauth/token/',
    clientIdEnv: 'MCP_SENTRY_CLIENT_ID',
    clientSecretEnv: 'MCP_SENTRY_CLIENT_SECRET',
    defaultScopes: ['project:read', 'event:read'],
    credentialKey: 'SENTRY_AUTH_TOKEN',
    tokenType: 'bearer',
  },
] as const

/** Lookup by providerId for O(1) access */
const PROVIDER_BY_ID = new Map<string, OAuthProviderConfig>(
  OAUTH_PROVIDERS.map((p) => [p.providerId, p])
)

/** Lookup by credentialKey for O(1) access */
const PROVIDER_BY_CREDENTIAL_KEY = new Map<string, OAuthProviderConfig>(
  OAUTH_PROVIDERS.map((p) => [p.credentialKey, p])
)

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/** Get the list of providers that support OAuth flows */
export function getSupportedOAuthProviders(): OAuthProviderConfig[] {
  return [...OAUTH_PROVIDERS]
}

/** Check if a given MCP credential key can be acquired via OAuth */
export function isOAuthCapable(credentialKey: string): boolean {
  return PROVIDER_BY_CREDENTIAL_KEY.has(credentialKey)
}

/** Get the OAuth provider config for a credential key */
export function getOAuthProvider(credentialKey: string): OAuthProviderConfig | null {
  return PROVIDER_BY_CREDENTIAL_KEY.get(credentialKey) ?? null
}

/** Get the OAuth provider config by provider ID */
export function getOAuthProviderById(providerId: string): OAuthProviderConfig | null {
  return PROVIDER_BY_ID.get(providerId) ?? null
}

/** Validate that required env vars are set for a provider */
export function isProviderConfigured(providerId: string): boolean {
  const provider = PROVIDER_BY_ID.get(providerId)
  if (!provider) {
    return false
  }

  const clientId = process.env[provider.clientIdEnv]
  const clientSecret = process.env[provider.clientSecretEnv]

  return !!clientId && !!clientSecret
}

/**
 * Generate an OAuth authorisation URL for a provider.
 *
 * Returns `null` if the provider is not recognised or not configured.
 */
export function generateOAuthUrl(params: {
  providerId: string
  state: string
  redirectUri: string
  scopes?: string[]
}): string | null {
  const provider = PROVIDER_BY_ID.get(params.providerId)
  if (!provider) {
    logger.warn('Unknown OAuth provider', { providerId: params.providerId })
    return null
  }

  const clientId = process.env[provider.clientIdEnv]
  if (!clientId) {
    logger.warn('OAuth provider not configured — missing client ID', {
      providerId: params.providerId,
      envVar: provider.clientIdEnv,
    })
    return null
  }

  const scopes = params.scopes?.length ? params.scopes : provider.defaultScopes

  const urlParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state: params.state,
  })

  // Google requires access_type=offline + prompt=consent for refresh tokens
  if (provider.providerId === 'google') {
    urlParams.set('access_type', 'offline')
    urlParams.set('prompt', 'consent')
  }

  return `${provider.authoriseUrl}?${urlParams.toString()}`
}

/**
 * Exchange an OAuth authorisation code for an access token.
 *
 * @throws {OAuthProviderError} When provider is unknown or not configured.
 * @throws {OAuthTokenExchangeError} When the token exchange request fails.
 */
export async function exchangeOAuthCode(params: {
  providerId: string
  code: string
  redirectUri: string
}): Promise<OAuthTokenResult> {
  const provider = PROVIDER_BY_ID.get(params.providerId)
  if (!provider) {
    throw new OAuthProviderError(`Unknown OAuth provider: ${params.providerId}`, params.providerId)
  }

  const clientId = process.env[provider.clientIdEnv]
  const clientSecret = process.env[provider.clientSecretEnv]

  if (!clientId || !clientSecret) {
    throw new OAuthProviderError(
      `OAuth provider "${provider.displayName}" is not configured — missing credentials`,
      params.providerId
    )
  }

  logger.info('Exchanging OAuth code for token', {
    providerId: params.providerId,
  })

  // GitHub uses JSON body; most other providers use form-encoded
  const isGitHub = provider.providerId === 'github'

  const headers: Record<string, string> = isGitHub
    ? { Accept: 'application/json', 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/x-www-form-urlencoded' }

  const bodyParams = {
    client_id: clientId,
    client_secret: clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
  }

  const body = isGitHub ? JSON.stringify(bodyParams) : new URLSearchParams(bodyParams).toString()

  let response: Response
  try {
    response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers,
      body,
    })
  } catch (error) {
    throw new OAuthTokenExchangeError(
      `Network error during token exchange with ${provider.displayName}`,
      params.providerId,
      undefined,
      { cause: error }
    )
  }

  if (!response.ok) {
    // Drain the response body to prevent connection leaks
    await response.text().catch(() => {})
    logger.error('OAuth token exchange returned non-OK status', {
      providerId: params.providerId,
      status: response.status,
    })
    throw new OAuthTokenExchangeError(
      `Token exchange with ${provider.displayName} failed (HTTP ${response.status})`,
      params.providerId,
      response.status
    )
  }

  const data = (await response.json()) as Record<string, unknown>

  // GitHub returns errors in the response body with a 200 status
  if (data.error) {
    logger.error('OAuth token exchange returned error in body', {
      providerId: params.providerId,
      error: data.error,
    })
    throw new OAuthTokenExchangeError(
      (data.error_description as string) ?? `Token exchange failed: ${String(data.error)}`,
      params.providerId
    )
  }

  // Slack nests the access token differently
  const accessToken =
    provider.providerId === 'slack'
      ? ((data.access_token as string | undefined) ??
        ((data.authed_user as Record<string, unknown> | undefined)?.access_token as
          | string
          | undefined))
      : (data.access_token as string | undefined)

  if (!accessToken) {
    throw new OAuthTokenExchangeError(
      `No access token returned from ${provider.displayName}`,
      params.providerId
    )
  }

  logger.info('OAuth token exchange successful', {
    providerId: params.providerId,
    hasRefreshToken: !!data.refresh_token,
    expiresIn: data.expires_in ?? null,
  })

  return {
    accessToken,
    refreshToken: (data.refresh_token as string) ?? undefined,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    tokenType: (data.token_type as string) ?? provider.tokenType,
    scope: (data.scope as string) ?? undefined,
  }
}
