import { checkRedisRateLimit } from './rate-limiter'

/** Default rate limit configuration per request identity type. */
const RATE_LIMIT_DEFAULTS = {
  authenticated: { limit: 1000, windowSeconds: 60 },
  unauthenticated: { limit: 100, windowSeconds: 60 },
  apiKey: { limit: 500, windowSeconds: 60 },
} as const

type RateLimitOptions = {
  limit?: number
  windowSeconds?: number
}

/**
 * Determine the request identity for rate limiting.
 * Priority: API key header > auth header > IP address.
 */
function getRequestIdentity(request: Request): {
  key: string
  type: 'authenticated' | 'unauthenticated' | 'apiKey'
} {
  const apiKey =
    request.headers.get('x-api-key') ?? request.headers.get('authorization')?.replace('Bearer ', '')

  if (apiKey?.startsWith('agv_')) {
    return { key: `apikey:${apiKey.slice(0, 16)}`, type: 'apiKey' }
  }

  // Check for Better Auth session (cookie-based auth)
  const hasCookieAuth = request.headers.get('cookie')?.includes('better-auth.session_token')
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? 'unknown'

  if (hasCookieAuth) {
    return { key: `auth:${ip}`, type: 'authenticated' }
  }

  return { key: `anon:${ip}`, type: 'unauthenticated' }
}

/**
 * Apply Redis-backed rate limiting to a REST API request.
 * Returns an error Response if the request is rate-limited, or null if allowed.
 *
 * Also returns rate limit headers to attach to the successful response.
 */
export async function applyRateLimit(
  request: Request,
  options?: RateLimitOptions
): Promise<{ response: Response | null; headers: Record<string, string> }> {
  const { key, type } = getRequestIdentity(request)
  const defaults = RATE_LIMIT_DEFAULTS[type]

  const limit = options?.limit ?? defaults.limit
  const windowSeconds = options?.windowSeconds ?? defaults.windowSeconds

  const result = await checkRedisRateLimit(key, limit, windowSeconds)

  const rateLimitHeaders: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt.getTime() / 1000)),
  }

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)

    return {
      response: new Response(
        JSON.stringify({ error: 'Too many requests — please try again later' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.max(retryAfter, 1)),
            ...rateLimitHeaders,
          },
        }
      ),
      headers: rateLimitHeaders,
    }
  }

  return { response: null, headers: rateLimitHeaders }
}
