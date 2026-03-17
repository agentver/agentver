import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AgentverError } from '@agentver/shared'

const DEFAULT_REGISTRY = 'https://app.agentver.com/api/v1'
const REQUEST_TIMEOUT_MS = 30_000

type Credentials = {
  token?: string
  apiKey?: string
}

type RequestOptions = {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

/** Read stored credentials from ~/.agentver/credentials.json */
export function getCredentials(): Credentials | null {
  const credPath = join(homedir(), '.agentver', 'credentials.json')

  if (!existsSync(credPath)) {
    return null
  }

  try {
    const raw = readFileSync(credPath, 'utf-8')
    return JSON.parse(raw) as Credentials
  } catch {
    return null
  }
}

/** Check whether valid credentials exist */
export function isAuthenticated(): boolean {
  const creds = getCredentials()
  return !!(creds?.token ?? creds?.apiKey)
}

/** Get the registry base URL, respecting AGENTVER_REGISTRY env override */
export function getRegistryUrl(): string {
  return process.env.AGENTVER_REGISTRY ?? DEFAULT_REGISTRY
}

/** Make an authenticated request to the Agentver registry */
export async function registryFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const credentials = getCredentials()
  const url = `${getRegistryUrl()}${path}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (credentials?.token) {
    headers.Authorization = `Bearer ${credentials.token}`
  } else if (credentials?.apiKey) {
    headers['X-API-Key'] = credentials.apiKey
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AgentverError(
        'INTERNAL_ERROR',
        'Registry request timed out. The service may be experiencing issues.'
      )
    }

    throw new AgentverError(
      'INTERNAL_ERROR',
      `Failed to connect to registry: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  clearTimeout(timeoutId)

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error')
    const code =
      response.status === 401
        ? 'UNAUTHORISED'
        : response.status === 403
          ? 'FORBIDDEN'
          : response.status === 404
            ? 'NOT_FOUND'
            : response.status === 409
              ? 'CONFLICT'
              : response.status === 429
                ? 'RATE_LIMITED'
                : 'INTERNAL_ERROR'

    throw new AgentverError(code, `Registry error (${response.status}): ${errorBody}`)
  }

  return response.json() as Promise<T>
}
