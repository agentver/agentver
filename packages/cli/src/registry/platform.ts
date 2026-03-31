import { AgentverError } from '@agentver/shared'
import { fetchWithRetry } from '../utils/retry'
import { getCredentials } from './auth.js'
import { getPlatformUrl } from './config.js'

const REQUEST_TIMEOUT_MS = 30_000
const HEALTH_CHECK_TIMEOUT_MS = 10_000

export type PlatformRequestOptions = {
  method?: string
  body?: unknown
  timeout?: number
}

export type PlatformSilentRequestOptions = PlatformRequestOptions & {
  rethrowAuthErrors?: boolean
}

export type PlatformResolveResponse = {
  gitUri: string
  gitPath?: string
  gitRef?: string
  source?: 'git' | 'platform'
  files?: Array<{ path: string; content: string }>
}

export async function platformFetch<T>(
  path: string,
  options: PlatformRequestOptions = {}
): Promise<T> {
  const platformUrl = getPlatformUrl()
  if (!platformUrl) {
    throw new AgentverError(
      'UNAUTHORISED',
      'No platform URL configured. Run `agentver login` to connect.'
    )
  }

  const credentials = await getCredentials()
  if (!credentials?.token && !credentials?.apiKey) {
    throw new AgentverError('UNAUTHORISED', 'Not authenticated. Run `agentver login` to sign in.')
  }

  const url = `${platformUrl}/api/v1${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (credentials.token) {
    headers.Authorization = `Bearer ${credentials.token}`
  } else if (credentials.apiKey) {
    headers['X-API-Key'] = credentials.apiKey
  }

  return fetchWithRetry<T>({
    label: 'Platform',
    timeoutMs: options.timeout ?? REQUEST_TIMEOUT_MS,
    buildRequest: () => ({
      url,
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }),
    onAuthExpired: () => {
      throw new AgentverError(
        'UNAUTHORISED',
        'Authentication expired. Run `agentver login` to re-authenticate.'
      )
    },
  })
}

export async function platformFetchSilent<T>(
  path: string,
  options: PlatformSilentRequestOptions = {}
): Promise<T | null> {
  try {
    return await platformFetch<T>(path, options)
  } catch (error) {
    if (
      options.rethrowAuthErrors === true &&
      error instanceof AgentverError &&
      error.code === 'UNAUTHORISED'
    ) {
      throw error
    }
    return null
  }
}

export async function isPlatformAvailable(): Promise<boolean> {
  const platformUrl = getPlatformUrl()
  if (!platformUrl) return false

  const url = `${platformUrl}/api/v1/health`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS)

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    return response.ok
  } catch {
    return false
  }
}
