import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../registry/client', () => ({
  getRegistryUrl: vi.fn(() => 'https://app.agentver.com/api/v1'),
}))

vi.mock('chalk', () => ({
  default: {
    red: (s: string) => s,
    dim: (s: string) => s,
  },
}))

describe('utils/network', () => {
  let networkModule: typeof import('../../utils/network')

  beforeEach(async () => {
    vi.clearAllMocks()
    networkModule = await import('../../utils/network')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('checkOnline', () => {
    it('returns true when health check succeeds', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

      expect(await networkModule.checkOnline()).toBe(true)
    })

    it('returns false when health check returns non-OK', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

      expect(await networkModule.checkOnline()).toBe(false)
    })

    it('returns false on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

      expect(await networkModule.checkOnline()).toBe(false)
    })

    it('calls the registry health endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      await networkModule.checkOnline()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://app.agentver.com/api/v1/health',
        expect.objectContaining({
          method: 'HEAD',
        })
      )
    })

    it('returns false on abort/timeout error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new DOMException('signal timed out', 'AbortError'))
      )

      expect(await networkModule.checkOnline()).toBe(false)
    })

    it('passes an AbortSignal for timeout control', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      await networkModule.checkOnline()

      const callOptions = mockFetch.mock.calls[0]![1]
      expect(callOptions).toHaveProperty('signal')
      expect(callOptions.signal).toBeInstanceOf(AbortSignal)
    })

    it('returns false on DNS resolution failure (ENOTFOUND)', async () => {
      const dnsError = new Error('getaddrinfo ENOTFOUND app.agentver.com')
      ;(dnsError as NodeJS.ErrnoException).code = 'ENOTFOUND'

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(dnsError))

      expect(await networkModule.checkOnline()).toBe(false)
    })

    it('returns false when fetch hangs and AbortSignal fires after timeout', async () => {
      vi.useFakeTimers()

      const mockFetch = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'))
            })
          })
      )
      vi.stubGlobal('fetch', mockFetch)

      const promise = networkModule.checkOnline()

      // Advance past the 3000ms timeout
      await vi.advanceTimersByTimeAsync(3_000)

      expect(await promise).toBe(false)

      vi.useRealTimers()
    })

    it('returns false when server returns 503 Service Unavailable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))

      expect(await networkModule.checkOnline()).toBe(false)
    })

    it('returns false when server is slow and abort signal fires before response', async () => {
      vi.useFakeTimers()

      // Simulate a fetch that resolves after 5s (well past the 3s timeout)
      const mockFetch = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const responseTimer = setTimeout(() => {
              resolve({ ok: true } as Response)
            }, 5_000)

            init?.signal?.addEventListener('abort', () => {
              clearTimeout(responseTimer)
              reject(new DOMException('The operation was aborted', 'AbortError'))
            })
          })
      )
      vi.stubGlobal('fetch', mockFetch)

      const promise = networkModule.checkOnline()

      // Advance past the 3000ms timeout but before the 5s response
      await vi.advanceTimersByTimeAsync(3_000)

      expect(await promise).toBe(false)

      vi.useRealTimers()
    })

    it('returns true when server responds with a redirect that resolves to ok', async () => {
      // fetch() follows redirects by default, so a 301/302 that ends at a 200
      // will appear as ok: true to the caller
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, redirected: true }))

      expect(await networkModule.checkOnline()).toBe(true)
    })

    it('returns false when redirect resolves to a non-ok status', async () => {
      // A redirect chain that ends at a non-ok response
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 502, redirected: true })
      )

      expect(await networkModule.checkOnline()).toBe(false)
    })
  })
})
