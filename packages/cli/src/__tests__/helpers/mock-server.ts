/**
 * Lightweight HTTP server for E2E tests needing platform API interaction.
 *
 * Unlike mock-platform.ts (which stubs globalThis.fetch for in-process tests),
 * this spins up a real HTTP server so the built CLI binary can make actual
 * network requests against it.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RouteHandler = (req: MockRequest, res: MockResponse) => void | Promise<void>

export type MockRequest = {
  /** Raw HTTP method (uppercased) */
  method: string
  /** Full URL path including query string */
  url: string
  /** Parsed URL pathname (without query string) */
  pathname: string
  /** Parsed query parameters */
  query: URLSearchParams
  /** Request headers (lowercased keys) */
  headers: Record<string, string | undefined>
  /** Parsed JSON body (or null if no body / not JSON) */
  body: unknown
  /** Raw body string */
  rawBody: string
}

export type MockResponse = {
  /** Send a JSON response with the given status code */
  json: (status: number, data: unknown) => void
  /** Send a plain text response */
  text: (status: number, text: string) => void
  /** Send an empty response */
  empty: (status: number) => void
}

export type RecordedRequest = {
  method: string
  pathname: string
  query: URLSearchParams
  headers: Record<string, string | undefined>
  body: unknown
  timestamp: number
}

export type MockRoute = {
  method: string
  /** String for exact prefix match, RegExp for pattern match — applied against the pathname */
  path: string | RegExp
  handler: RouteHandler
}

export type MockPlatformServer = {
  /** Base URL including protocol and port, e.g. http://127.0.0.1:54321 */
  url: string
  /** The underlying Node HTTP server */
  server: Server
  /** Shut down the server and release the port */
  close: () => Promise<void>
  /** Register a custom route (prepended, so it takes priority over defaults) */
  addRoute: (method: string, path: string | RegExp, handler: RouteHandler) => void
  /** Return all recorded requests for assertion */
  getRequests: () => RecordedRequest[]
  /** Return recorded requests filtered by method and path prefix */
  getRequestsFor: (method: string, pathPrefix: string) => RecordedRequest[]
  /** Clear recorded requests */
  clearRequests: () => void
}

// ---------------------------------------------------------------------------
// Default user and organisation data
// ---------------------------------------------------------------------------

const DEFAULT_USER = {
  id: 'usr_test_123',
  email: 'test@agentver.dev',
  name: 'Test User',
  organisations: [{ slug: 'test-org', name: 'Test Organisation', role: 'OWNER' }],
}

const DEFAULT_SEARCH_RESULTS = {
  results: [
    {
      id: 'skill_abc123',
      name: 'example-skill',
      slug: 'example-skill',
      description: 'An example skill from the platform',
      type: 'SKILL',
      tags: ['testing'],
      compatibilityAgents: ['claude-code'],
      starCount: 42,
      installCount: 1_234,
      organisation: { slug: 'test-org', name: 'Test Organisation' },
      categories: [{ id: 'cat_1', name: 'Testing', slug: 'testing', icon: null }],
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
}

// ---------------------------------------------------------------------------
// Default route definitions
// ---------------------------------------------------------------------------

function createDefaultRoutes(): MockRoute[] {
  return [
    // Health check
    {
      method: 'HEAD',
      path: '/api/v1/health',
      handler: (_req, res) => res.empty(200),
    },
    {
      method: 'GET',
      path: '/api/v1/health',
      handler: (_req, res) => res.json(200, { status: 'ok' }),
    },

    // Auth / whoami
    {
      method: 'GET',
      path: '/api/v1/me',
      handler: (req, res) => {
        const authHeader = req.headers.authorization ?? req.headers['x-api-key']
        if (!authHeader) {
          res.json(401, { error: { code: 'UNAUTHORISED', message: 'Not authenticated' } })
          return
        }
        res.json(200, DEFAULT_USER)
      },
    },

    // Search
    {
      method: 'GET',
      path: '/api/v1/search',
      handler: (_req, res) => res.json(200, DEFAULT_SEARCH_RESULTS),
    },
    // Some commands use /skills/search instead
    {
      method: 'GET',
      path: '/api/v1/skills/search',
      handler: (_req, res) => res.json(200, DEFAULT_SEARCH_RESULTS),
    },

    // Installations
    {
      method: 'GET',
      path: '/api/v1/installations',
      handler: (_req, res) => res.json(200, { installations: [] }),
    },
    {
      method: 'POST',
      path: '/api/v1/installations/sync',
      handler: (_req, res) => res.json(200, { synced: 0, removed: 0 }),
    },
    {
      method: 'POST',
      path: '/api/v1/installations',
      handler: (_req, res) => res.json(200, { id: 'inst_test_123' }),
    },
    {
      method: 'DELETE',
      path: /^\/api\/v1\/installations\/[^/]+$/,
      handler: (_req, res) => res.json(200, { deleted: true }),
    },

    // Skill detail (catch-all for GET /api/v1/skills/@org/name)
    {
      method: 'GET',
      path: /^\/api\/v1\/skills\/@[^/]+\/[^/]+$/,
      handler: (req, res) => {
        const segments = req.pathname.split('/')
        const name = segments[segments.length - 1] ?? 'unknown'
        res.json(200, {
          name,
          description: 'A test skill',
          type: 'SKILL',
        })
      },
    },

    // Versions (list)
    {
      method: 'GET',
      path: /^\/api\/v1\/skills\/@[^/]+\/[^/]+\/versions$/,
      handler: (_req, res) =>
        res.json(200, {
          versions: [
            {
              name: 'v/1.0.0',
              tag: 'v/1.0.0',
              commitSha: 'abc1234567890abcdef1234567890abcdef123456',
              message: 'Initial release',
            },
          ],
        }),
    },

    // Versions (create)
    {
      method: 'POST',
      path: /^\/api\/v1\/skills\/@[^/]+\/[^/]+\/versions$/,
      handler: (req, res) => {
        const body = req.body as { version?: string; commitSha?: string } | null
        res.json(200, {
          tag: `v/${body?.version ?? '1.0.0'}`,
          commitSha: body?.commitSha ?? 'abc1234567890abcdef1234567890abcdef123456',
        })
      },
    },

    // Drafts (list)
    {
      method: 'GET',
      path: /^\/api\/v1\/skills\/@[^/]+\/[^/]+\/drafts$/,
      handler: (_req, res) => res.json(200, []),
    },

    // Drafts (create / merge / delete)
    {
      method: 'POST',
      path: /^\/api\/v1\/skills\/@[^/]+\/[^/]+\/drafts$/,
      handler: (req, res) => {
        const body = req.body as { name?: string; action?: string } | null
        if (body?.action === 'merge') {
          res.json(200, { commitSha: 'merged123456789abcdef' })
        } else if (body?.action === 'delete') {
          res.json(200, { deleted: true })
        } else {
          res.json(200, {
            name: body?.name ?? 'new-draft',
            branchName: `draft/skill/${body?.name ?? 'new-draft'}`,
          })
        }
      },
    },

    // Publish
    {
      method: 'POST',
      path: /^\/api\/v1\/skills\/@[^/]+\/[^/]+\/publish$/,
      handler: (req, res) => {
        const body = req.body as { version?: string } | null
        res.json(200, {
          version: body?.version ?? '1.0.0',
          commitSha: 'pub1234567890abcdef1234567890abcdef123456',
        })
      },
    },

    // Resolve (used by draft switch)
    {
      method: 'GET',
      path: '/api/v1/resolve',
      handler: (req, res) => {
        const name = req.query.get('name') ?? 'unknown'
        const ref = req.query.get('ref') ?? 'main'
        res.json(200, {
          gitUri: `agentver://${name}`,
          gitRef: ref,
          source: 'platform',
          files: [{ path: 'SKILL.md', content: '---\nname: test-skill\n---\n\n# Test Skill\n' }],
        })
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Route matching
// ---------------------------------------------------------------------------

function matchRoute(routes: MockRoute[], method: string, pathname: string): MockRoute | undefined {
  const normalisedMethod = method.toUpperCase()

  for (const route of routes) {
    if (route.method.toUpperCase() !== normalisedMethod) continue

    if (typeof route.path === 'string') {
      if (pathname === route.path || pathname.startsWith(`${route.path}?`)) return route
    } else {
      if (route.path.test(pathname)) return route
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Request body parser
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function parseJsonBody(rawBody: string): unknown {
  if (!rawBody.trim()) return null
  try {
    return JSON.parse(rawBody)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export type CreateMockPlatformServerOptions = {
  /** Override or extend default routes. Custom routes take priority. */
  routes?: MockRoute[]
  /** Disable default routes entirely (only use custom routes). */
  noDefaults?: boolean
}

/**
 * Create and start a mock platform HTTP server on a random available port.
 *
 * Returns immediately once the server is listening. All requests are recorded
 * for later assertion via getRequests().
 */
export async function createMockPlatformServer(
  options: CreateMockPlatformServerOptions = {}
): Promise<MockPlatformServer> {
  const defaultRoutes = options.noDefaults ? [] : createDefaultRoutes()
  const customRoutes: MockRoute[] = options.routes ? [...options.routes] : []

  // Custom routes checked first, then defaults
  const allRoutes = (): MockRoute[] => [...customRoutes, ...defaultRoutes]

  const recordedRequests: RecordedRequest[] = []

  const server = createServer(async (rawReq: IncomingMessage, rawRes: ServerResponse) => {
    const method = (rawReq.method ?? 'GET').toUpperCase()
    const fullUrl = rawReq.url ?? '/'
    const parsedUrl = new URL(fullUrl, 'http://localhost')
    const pathname = parsedUrl.pathname
    const query = parsedUrl.searchParams

    // Read and parse body
    const rawBody = await readBody(rawReq)
    const body = parseJsonBody(rawBody)

    // Build headers map (Node gives lowercased keys)
    const headers: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(rawReq.headers)) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value
    }

    // Record the request
    recordedRequests.push({
      method,
      pathname,
      query,
      headers,
      body,
      timestamp: Date.now(),
    })

    // Build the MockRequest and MockResponse wrappers
    const mockReq: MockRequest = {
      method,
      url: fullUrl,
      pathname,
      query,
      headers,
      body,
      rawBody,
    }

    const mockRes: MockResponse = {
      json(status: number, data: unknown) {
        rawRes.writeHead(status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        })
        rawRes.end(JSON.stringify(data))
      },
      text(status: number, text: string) {
        rawRes.writeHead(status, {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
        })
        rawRes.end(text)
      },
      empty(status: number) {
        rawRes.writeHead(status, {
          'Access-Control-Allow-Origin': '*',
        })
        rawRes.end()
      },
    }

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      rawRes.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      })
      rawRes.end()
      return
    }

    // Match route
    const route = matchRoute(allRoutes(), method, pathname)

    if (route) {
      try {
        await route.handler(mockReq, mockRes)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        mockRes.json(500, { error: { code: 'INTERNAL_ERROR', message } })
      }
    } else {
      mockRes.json(404, {
        error: {
          code: 'NOT_FOUND',
          message: `No mock route for ${method} ${pathname}`,
        },
      })
    }
  })

  // Start on a random port
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to get server address')
  }

  const url = `http://127.0.0.1:${address.port}`

  return {
    url,
    server,

    async close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },

    addRoute(method: string, path: string | RegExp, handler: RouteHandler) {
      customRoutes.unshift({ method, path, handler })
    },

    getRequests() {
      return [...recordedRequests]
    },

    getRequestsFor(method: string, pathPrefix: string) {
      const normalisedMethod = method.toUpperCase()
      return recordedRequests.filter(
        (r) => r.method === normalisedMethod && r.pathname.startsWith(pathPrefix)
      )
    },

    clearRequests() {
      recordedRequests.length = 0
    },
  }
}

// ---------------------------------------------------------------------------
// Credential helpers for E2E tests
// ---------------------------------------------------------------------------

export type MockCredentialsOptions = {
  /** The mock server URL to set as platformUrl in config */
  platformUrl: string
  /** Auth token (defaults to 'e2e-test-token') */
  token?: string
  /** API key (alternative to token) */
  apiKey?: string
  /** Default organisation slug for config */
  defaultOrg?: string
}

/**
 * Write credentials and config files to a temporary HOME directory so
 * the CLI binary (running as a child process) authenticates against
 * the mock server.
 *
 * The CLI reads from ~/.agentver/credentials.json and ~/.agentver/config.json.
 */
export function writeMockCredentials(homeDir: string, options: MockCredentialsOptions): void {
  const agentverDir = join(homeDir, '.agentver')
  mkdirSync(agentverDir, { recursive: true })

  // Write credentials
  const credentials: Record<string, string> = {}
  if (options.apiKey) {
    credentials.apiKey = options.apiKey
  } else {
    credentials.token = options.token ?? 'e2e-test-token'
  }

  writeFileSync(
    join(agentverDir, 'credentials.json'),
    JSON.stringify(credentials, null, 2),
    'utf-8'
  )

  // Write config
  const config: Record<string, unknown> = {
    platformUrl: options.platformUrl,
  }
  if (options.defaultOrg) {
    config.defaultOrg = options.defaultOrg
  }

  writeFileSync(join(agentverDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * Write config only (no credentials) — for testing unauthenticated flows
 * where the CLI is connected to a platform but has no valid token.
 */
export function writeMockConfig(
  homeDir: string,
  options: { platformUrl: string; defaultOrg?: string }
): void {
  const agentverDir = join(homeDir, '.agentver')
  mkdirSync(agentverDir, { recursive: true })

  const config: Record<string, unknown> = {
    platformUrl: options.platformUrl,
  }
  if (options.defaultOrg) {
    config.defaultOrg = options.defaultOrg
  }

  writeFileSync(join(agentverDir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8')
}
