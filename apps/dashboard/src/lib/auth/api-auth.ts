import { createHash } from 'node:crypto'
import { prisma } from '@agentver/database'
import { auth } from '@/lib/auth/auth'
import { checkApiKeyRateLimit } from './api-key-rate-limit'

export type AuthResult = {
  userId: string
  organisationId?: string
  scopes: string[]
}

export type AuthError = {
  status: number
  message: string
  retryAfter?: number
}

export type AuthResponse = { ok: true; result: AuthResult } | { ok: false; error: AuthError }

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Scope hierarchy: ADMIN > WRITE > READ.
 * Each higher scope includes the permissions of all lower scopes.
 */
const SCOPE_HIERARCHY: Record<string, number> = {
  READ: 1,
  WRITE: 2,
  ADMIN: 3,
}

/**
 * Map HTTP method to the minimum scope required.
 */
function requiredScopeForMethod(method: string): string {
  switch (method.toUpperCase()) {
    case 'DELETE':
      return 'ADMIN'
    case 'POST':
    case 'PUT':
    case 'PATCH':
      return 'WRITE'
    default:
      return 'READ'
  }
}

/**
 * Check whether the provided scopes satisfy the required scope.
 */
function hasSufficientScope(scopes: string[], requiredScope: string): boolean {
  const requiredLevel = SCOPE_HIERARCHY[requiredScope] ?? 0
  return scopes.some((s) => (SCOPE_HIERARCHY[s] ?? 0) >= requiredLevel)
}

/**
 * Authenticate an API request and enforce per-key rate limits + scope checks.
 * Returns a discriminated union so callers can distinguish auth failures
 * from rate limit / scope errors with appropriate HTTP responses.
 */
export async function authenticateRequestWithDetails(request: Request): Promise<AuthResponse> {
  const apiKey = request.headers.get('x-api-key')

  if (apiKey) {
    const keyHash = hashApiKey(apiKey)
    const key = await prisma.apiKey.findUnique({ where: { keyHash } })

    if (!key) {
      return { ok: false, error: { status: 401, message: 'Invalid API key' } }
    }

    if (key.expiresAt && key.expiresAt < new Date()) {
      return { ok: false, error: { status: 401, message: 'API key has expired' } }
    }

    // Per-key rate limit check
    const rateLimitResult = await checkApiKeyRateLimit(keyHash, key.rateLimit)
    if (!rateLimitResult.allowed) {
      return {
        ok: false,
        error: {
          status: 429,
          message: 'API key rate limit exceeded',
          retryAfter: Math.ceil(rateLimitResult.resetMs / 1000),
        },
      }
    }

    // Scope enforcement
    const requiredScope = requiredScopeForMethod(request.method)
    if (!hasSufficientScope(key.scopes, requiredScope)) {
      return {
        ok: false,
        error: {
          status: 403,
          message: `Insufficient scope — ${requiredScope} required, key has [${key.scopes.join(', ')}]`,
        },
      }
    }

    // Update last-used timestamp (fire-and-forget)
    prisma.apiKey
      .update({
        where: { id: key.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {
        // Silently ignore — non-critical update
      })

    return {
      ok: true,
      result: {
        userId: key.userId,
        organisationId: key.organisationId,
        scopes: key.scopes,
      },
    }
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)

    // Check CLI session first (custom tokens from agentver login)
    const tokenHash = hashApiKey(token)
    const cliSession = await prisma.cliSession.findUnique({ where: { tokenHash } })

    if (cliSession) {
      if (cliSession.expiresAt && cliSession.expiresAt < new Date()) {
        return {
          ok: false,
          error: {
            status: 401,
            message: 'CLI session has expired. Run `agentver login` to re-authenticate.',
          },
        }
      }

      // Update last-used (fire-and-forget)
      prisma.cliSession
        .update({
          where: { id: cliSession.id },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => {})

      return {
        ok: true,
        result: {
          userId: cliSession.userId,
          scopes: ['READ', 'WRITE', 'ADMIN'],
        },
      }
    }

    // Fall through to Better Auth session validation
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) {
      return { ok: false, error: { status: 401, message: 'Invalid bearer token' } }
    }

    const user = await prisma.user.findUnique({ where: { id: session.user.id } })
    if (!user) {
      return { ok: false, error: { status: 401, message: 'User not found' } }
    }

    return {
      ok: true,
      result: {
        userId: user.id,
        scopes: ['READ', 'WRITE', 'ADMIN'],
      },
    }
  }

  return { ok: false, error: { status: 401, message: 'Unauthorised' } }
}

/**
 * Backwards-compatible authentication that returns AuthResult | null.
 * Existing route handlers that only check for null can continue to work.
 * For new routes, prefer `authenticateRequestWithDetails` for richer error responses.
 */
export async function authenticateRequest(request: Request): Promise<AuthResult | null> {
  const response = await authenticateRequestWithDetails(request)
  return response.ok ? response.result : null
}
