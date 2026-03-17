import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../registry/auth', () => ({
  getCredentials: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../utils/retry', async () => {
  const actual = await vi.importActual<typeof import('../../utils/retry')>('../../utils/retry')
  return actual
})

describe('registry/client', () => {
  let clientModule: typeof import('../../registry/client')
  let authModule: typeof import('../../registry/auth')

  beforeEach(async () => {
    vi.clearAllMocks()
    clientModule = await import('../../registry/client')
    authModule = await import('../../registry/auth')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe('getRegistryUrl', () => {
    it('returns the default registry URL', () => {
      delete process.env.AGENTVER_REGISTRY
      expect(clientModule.getRegistryUrl()).toBe('https://app.agentver.com/api/v1')
    })

    it('returns custom registry URL from env', () => {
      vi.stubEnv('AGENTVER_REGISTRY', 'https://custom-registry.com/api')
      // Re-import to pick up env change
      expect(clientModule.getRegistryUrl()).toBe('https://custom-registry.com/api')
    })
  })

  describe('registryFetch', () => {
    it('makes a GET request by default', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ data: 'test' }),
        text: vi.fn(),
      }

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))
      vi.mocked(authModule.getCredentials).mockResolvedValue(null)

      const result = await clientModule.registryFetch('/test')
      expect(result).toEqual({ data: 'test' })
    })

    it('adds Authorization header when token is available', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      })

      vi.stubGlobal('fetch', mockFetch)
      vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'my-token' })

      await clientModule.registryFetch('/test')

      const callHeaders = mockFetch.mock.calls[0]![1]!.headers
      expect(callHeaders.Authorization).toBe('Bearer my-token')
    })

    it('adds X-API-Key header when apiKey is available', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      })

      vi.stubGlobal('fetch', mockFetch)
      vi.mocked(authModule.getCredentials).mockResolvedValue({ apiKey: 'my-api-key' })

      await clientModule.registryFetch('/test')

      const callHeaders = mockFetch.mock.calls[0]![1]!.headers
      expect(callHeaders['X-API-Key']).toBe('my-api-key')
    })

    it('throws on 4xx errors', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: vi.fn().mockResolvedValue('Bad request'),
        })
      )

      vi.mocked(authModule.getCredentials).mockResolvedValue(null)

      await expect(clientModule.registryFetch('/test')).rejects.toThrow('400')
    })

    it('throws RegistryTimeoutError on abort', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(Object.assign(new DOMException('aborted', 'AbortError')))
      )

      vi.mocked(authModule.getCredentials).mockResolvedValue(null)

      await expect(clientModule.registryFetch('/test')).rejects.toThrow('timed out')
    })

    it('sends body as JSON for POST requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      })

      vi.stubGlobal('fetch', mockFetch)
      vi.mocked(authModule.getCredentials).mockResolvedValue(null)

      await clientModule.registryFetch('/test', {
        method: 'POST',
        body: { key: 'value' },
      })

      expect(mockFetch.mock.calls[0]![1]!.body).toBe(JSON.stringify({ key: 'value' }))
      expect(mockFetch.mock.calls[0]![1]!.method).toBe('POST')
    })

    it('retries on 500 errors with increasing delays', async () => {
      vi.useFakeTimers()

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: vi.fn().mockResolvedValue('Internal Server Error'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: vi.fn().mockResolvedValue('Internal Server Error'),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ recovered: true }),
        })

      vi.stubGlobal('fetch', mockFetch)
      vi.mocked(authModule.getCredentials).mockResolvedValue(null)
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      const resultPromise = clientModule.registryFetch('/test')

      // Advance past the first retry delay (1s)
      await vi.advanceTimersByTimeAsync(1_000)
      // Advance past the second retry delay (2s)
      await vi.advanceTimersByTimeAsync(2_000)

      const result = await resultPromise
      expect(result).toEqual({ recovered: true })
      expect(mockFetch).toHaveBeenCalledTimes(3)

      vi.useRealTimers()
    })

    it('retries 401 responses — onAuthExpired throw is caught as retryable (no response in catch)', async () => {
      vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'expired-token' })

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: vi.fn().mockResolvedValue('Unauthorised'),
        })
      )

      await expect(clientModule.registryFetch('/test')).rejects.toThrow('Authentication expired')

      // onAuthExpired() throws before lastResponse is assigned, so the catch block
      // sees lastResponse = undefined → isRetryable returns true → all 3 attempts run
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3)
    })
  })
})
