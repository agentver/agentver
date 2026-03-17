import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import { checkApiKeyRateLimit } from '@/lib/auth/api-key-rate-limit'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

const PUBLIC_ROUTE_PATTERNS = [
  /^\/sign-in(.*)/,
  /^\/sign-up(.*)/,
  /^\/auth\/token$/,
  /^\/api\/v1\/(.*)/,
  /^\/api\/webhooks\/(.*)/,
  /^\/api\/auth\/(.*)/,
]

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname))
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown'
  }
  return request.headers.get('x-real-ip') ?? 'unknown'
}

function getRateLimitConfig(pathname: string, method: string) {
  if (pathname.startsWith('/api/v1/auth/token') || pathname === '/auth/token') {
    return RATE_LIMITS.authToken
  }

  if (pathname.startsWith('/api/webhooks/')) {
    return RATE_LIMITS.webhook
  }

  if (pathname.startsWith('/api/v1/skills')) {
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      return RATE_LIMITS.skillsWrite
    }
    return RATE_LIMITS.skillsRead
  }

  return RATE_LIMITS.default
}

/**
 * Default per-key rate limit for early middleware rejection.
 * The actual per-key limit is read from the database inside route handlers
 * via authenticateRequestWithDetails. This middleware check uses a generous
 * fallback so that obvious abuse is caught early without a DB lookup.
 */
const MIDDLEWARE_KEY_RATE_LIMIT = 1200

export async function proxy(req: NextRequest) {
  const { pathname } = new URL(req.url)

  // Rate-limit public API routes and auth endpoints
  if (
    pathname.startsWith('/api/v1/') ||
    pathname.startsWith('/api/webhooks/') ||
    pathname === '/auth/token'
  ) {
    const ip = getClientIp(req)
    const rateLimitConfig = getRateLimitConfig(pathname, req.method)
    const key = `${ip}:${pathname.split('/').slice(0, 4).join('/')}`

    const result = await checkRateLimit(key, rateLimitConfig)

    if (!result.allowed) {
      return NextResponse.json(
        { error: 'Too many requests — please try again later' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(result.resetMs / 1000)),
            'X-RateLimit-Remaining': '0',
          },
        }
      )
    }

    // Per-API-key rate limiting in middleware (early rejection for obvious abuse)
    const apiKey = req.headers.get('x-api-key')
    if (apiKey) {
      const encoded = new TextEncoder().encode(apiKey)
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
      const keyHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const keyResult = await checkApiKeyRateLimit(keyHash, MIDDLEWARE_KEY_RATE_LIMIT)

      if (!keyResult.allowed) {
        return NextResponse.json(
          { error: 'API key rate limit exceeded' },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil(keyResult.resetMs / 1000)),
              'X-RateLimit-Remaining': '0',
            },
          }
        )
      }
    }
  }

  if (!isPublicRoute(pathname)) {
    const sessionCookie = getSessionCookie(req)

    if (!sessionCookie) {
      const signInUrl = new URL('/sign-in', req.url)
      signInUrl.searchParams.set('redirect_url', pathname + (req.nextUrl.search ?? ''))
      return NextResponse.redirect(signInUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next|api/health|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/((?!api/health))(api|trpc)(.*)',
  ],
}
