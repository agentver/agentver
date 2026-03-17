const MAX_RETRY_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 1_000

type RequestConfig = {
  url: string
  method?: string
  headers: Record<string, string>
  body?: string
}

export type RetryOptions = {
  label: string
  timeoutMs: number
  buildRequest: () => RequestConfig
  onAuthExpired: () => never
}

export class RequestTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} request timed out. The service may be experiencing issues.`)
    this.name = 'RequestTimeoutError'
  }
}

function isRetryable(error: unknown, response?: Response): boolean {
  if (error instanceof RequestTimeoutError) return false
  if (error instanceof DOMException && error.name === 'AbortError') return false

  if (!response) return true

  return response.status >= 500
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAuthExpired(status: number): boolean {
  return status === 401
}

export async function fetchWithRetry<T>(options: RetryOptions): Promise<T> {
  let lastError: unknown
  let lastResponse: Response | undefined

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs)

    try {
      const config = options.buildRequest()

      const response = await fetch(config.url, {
        method: config.method ?? 'GET',
        headers: config.headers,
        body: config.body,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        return response.json() as Promise<T>
      }

      if (isAuthExpired(response.status)) {
        options.onAuthExpired()
      }

      lastResponse = response
      lastError = new Error(
        `${options.label} error (${response.status}): ${await response.text().catch(() => 'Unknown error')}`
      )

      if (!isRetryable(undefined, response)) {
        throw lastError
      }
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new RequestTimeoutError(options.label)
      }

      lastError = error
      lastResponse = undefined

      if (!isRetryable(error)) {
        throw error
      }
    }

    if (attempt < MAX_RETRY_ATTEMPTS) {
      const retryDelay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
      process.stderr.write(
        `${options.label} request failed (attempt ${attempt}/${MAX_RETRY_ATTEMPTS}), retrying in ${retryDelay / 1_000}s...\n`
      )
      await delay(retryDelay)
    }
  }

  if (lastResponse && !lastResponse.ok) {
    throw lastError
  }

  throw lastError
}
