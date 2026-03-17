import { fetchWithRetry } from '../utils/retry'
import { getCredentials } from './auth'

const DEFAULT_REGISTRY = 'https://app.agentver.com/api/v1'
const REQUEST_TIMEOUT_MS = 30_000

export { RequestTimeoutError as RegistryTimeoutError } from '../utils/retry'

type RequestOptions = {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

export function getRegistryUrl(): string {
  return process.env.AGENTVER_REGISTRY ?? DEFAULT_REGISTRY
}

export async function registryFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const credentials = await getCredentials()
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

  return fetchWithRetry<T>({
    label: 'Registry',
    timeoutMs: REQUEST_TIMEOUT_MS,
    buildRequest: () => ({
      url,
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }),
    onAuthExpired: () => {
      throw new Error('Authentication expired. Run `agentver login` to re-authenticate.')
    },
  })
}
