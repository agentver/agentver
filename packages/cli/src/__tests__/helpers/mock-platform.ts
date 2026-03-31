/**
 * HTTP/fetch mocking helpers for platform and registry API calls.
 * Tests call setupPlatformMock() inside beforeEach to stub global fetch
 * with route-based dispatch.
 */

import { vi } from 'vitest'
import {
  createConfig,
  createCredentials,
  createPlatformSearchResult,
  createPlatformVersionResponse,
} from './fixtures'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MockRoute = {
  method: string
  path: string | RegExp
  handler: (url: string, init?: RequestInit) => Response
}

export type PlatformMockHandle = {
  /** Add a route at runtime (e.g. inside a specific test). */
  addRoute: (route: MockRoute) => void
  /** Remove all custom routes and reset call history. */
  reset: () => void
  /** The underlying mock fn — useful for assertions like expect(fetchMock).toHaveBeenCalled(). */
  fetchMock: ReturnType<typeof vi.fn>
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export function mockFetchResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>
): Response {
  const responseHeaders = new Headers(headers)
  if (!responseHeaders.has('Content-Type')) {
    responseHeaders.set('Content-Type', 'application/json')
  }

  return new Response(JSON.stringify(body), {
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: responseHeaders,
  })
}

export function mockFetchError(message: string): never {
  throw new TypeError(message)
}

// ---------------------------------------------------------------------------
// Default routes — covers common platform endpoints
// ---------------------------------------------------------------------------

export const DEFAULT_PLATFORM_ROUTES: MockRoute[] = [
  {
    method: 'HEAD',
    path: /\/api\/v1\/health$/,
    handler: () => new Response(null, { status: 200 }),
  },
  {
    method: 'GET',
    path: /\/api\/v1\/health$/,
    handler: () => mockFetchResponse(200, { status: 'ok' }),
  },
  {
    method: 'GET',
    path: /\/api\/v1\/installations$/,
    handler: () => mockFetchResponse(200, { installations: [] }),
  },
  {
    method: 'GET',
    path: /\/api\/v1\/skills\/search/,
    handler: () => mockFetchResponse(200, createPlatformSearchResult()),
  },
  {
    method: 'GET',
    path: /\/api\/v1\/skills\/[^/]+\/versions$/,
    handler: () => mockFetchResponse(200, createPlatformVersionResponse()),
  },
  {
    method: 'GET',
    path: /\/api\/v1\/skills\/[^/]+$/,
    handler: (_url) => {
      const name = _url.split('/skills/').pop()?.split('?')[0] ?? 'unknown'
      return mockFetchResponse(200, {
        name,
        description: 'A test skill',
        type: 'SKILL',
      })
    },
  },
]

// ---------------------------------------------------------------------------
// Route matching
// ---------------------------------------------------------------------------

function matchRoute(routes: MockRoute[], url: string, method: string): MockRoute | undefined {
  const normalisedMethod = method.toUpperCase()

  for (const route of routes) {
    if (route.method.toUpperCase() !== normalisedMethod) continue

    if (typeof route.path === 'string') {
      if (url.includes(route.path)) return route
    } else {
      if (route.path.test(url)) return route
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Stubs global fetch with route-based dispatch.
 * Call inside beforeEach or at the start of an individual test.
 *
 * Routes are checked in order — custom routes added via addRoute()
 * are prepended so they take priority over defaults.
 */
export function setupPlatformMock(
  routes: MockRoute[] = DEFAULT_PLATFORM_ROUTES
): PlatformMockHandle {
  const activeRoutes: MockRoute[] = [...routes]

  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'

      const matched = matchRoute(activeRoutes, url, method)
      if (matched) {
        return matched.handler(url, init)
      }

      // Unmatched routes return 404 by default
      return mockFetchResponse(404, {
        error: { code: 'NOT_FOUND', message: `No mock route for ${method} ${url}` },
      })
    }
  )

  globalThis.fetch = fetchMock as typeof fetch

  return {
    addRoute(route: MockRoute) {
      // Prepend so custom routes take priority
      activeRoutes.unshift(route)
    },
    reset() {
      activeRoutes.length = 0
      activeRoutes.push(...routes)
      fetchMock.mockClear()
    },
    fetchMock,
  }
}

// ---------------------------------------------------------------------------
// Auth state helpers
// ---------------------------------------------------------------------------

/**
 * Sets up mocks for an authenticated user connected to a platform.
 * Call after vi.mock() declarations in the test file.
 *
 * Returns the mocked modules so the test can adjust behaviour.
 */
export async function createAuthenticatedState(): Promise<{
  configModule: typeof import('../../registry/config')
  authModule: typeof import('../../registry/auth')
}> {
  const configModule = await import('../../registry/config')
  const authModule = await import('../../registry/auth')

  const config = createConfig()
  const credentials = createCredentials()

  vi.mocked(configModule.getPlatformUrl).mockReturnValue(
    config.platformUrl ?? 'https://app.agentver.com'
  )
  vi.mocked(configModule.readConfig).mockReturnValue(config)
  vi.mocked(authModule.getCredentials).mockResolvedValue(credentials)
  vi.mocked(authModule.isAuthenticated).mockResolvedValue(true)

  return { configModule, authModule }
}

/**
 * Sets up mocks for an unauthenticated user with no platform connection.
 */
export async function createUnauthenticatedState(): Promise<{
  configModule: typeof import('../../registry/config')
  authModule: typeof import('../../registry/auth')
}> {
  const configModule = await import('../../registry/config')
  const authModule = await import('../../registry/auth')

  vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)
  vi.mocked(configModule.readConfig).mockReturnValue({})
  vi.mocked(authModule.getCredentials).mockResolvedValue(null)
  vi.mocked(authModule.isAuthenticated).mockResolvedValue(false)

  return { configModule, authModule }
}
