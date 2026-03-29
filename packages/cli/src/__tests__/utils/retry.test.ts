import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithRetry, RequestTimeoutError, type RetryOptions } from '../../utils/retry'

function buildOptions(overrides?: Partial<RetryOptions>): RetryOptions {
  return {
    label: 'Test',
    timeoutMs: 5_000,
    buildRequest: () => ({
      url: 'https://example.com/api',
      headers: { 'Content-Type': 'application/json' },
    }),
    onAuthExpired: () => {
      throw new Error('Auth expired')
    },
    ...overrides,
  }
}

function mockResponse(props: {
  ok: boolean
  status?: number
  text?: () => Promise<string>
  json?: () => Promise<unknown>
}): Response {
  return {
    ok: props.ok,
    status: props.status ?? (props.ok ? 200 : 500),
    text: props.text ?? (() => Promise.resolve('')),
    json: props.json ?? (() => Promise.resolve({})),
  } as Response
}

describe('utils/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('RequestTimeoutError', () => {
    it('has correct name and message', () => {
      const error = new RequestTimeoutError('MyLabel')

      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('RequestTimeoutError')
      expect(error.message).toContain('MyLabel')
      expect(error.message).toContain('timed out')
    })
  })

  describe('fetchWithRetry', () => {
    it('returns parsed JSON on successful first attempt', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          json: () => Promise.resolve({ data: 'ok' }),
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      const result = await fetchWithRetry<{ data: string }>(buildOptions())

      expect(result).toEqual({ data: 'ok' })
      expect(mockFetch).toHaveBeenCalledOnce()
    })

    it('passes correct method, headers, body, and signal to fetch', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: true,
          json: () => Promise.resolve({}),
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      await fetchWithRetry(
        buildOptions({
          buildRequest: () => ({
            url: 'https://example.com/submit',
            method: 'POST',
            headers: { Authorization: 'Bearer x' },
            body: '{"key":"val"}',
          }),
        })
      )

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/submit', {
        method: 'POST',
        headers: { Authorization: 'Bearer x' },
        body: '{"key":"val"}',
        signal: expect.any(AbortSignal),
      })
    })

    it('retries on 5xx and succeeds on second attempt', async () => {
      vi.useFakeTimers()
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          mockResponse({
            ok: false,
            status: 502,
            text: () => Promise.resolve('Bad Gateway'),
          })
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ recovered: true }),
          })
        )
      vi.stubGlobal('fetch', mockFetch)

      const promise = fetchWithRetry<{ recovered: boolean }>(buildOptions())
      await vi.advanceTimersByTimeAsync(1_000)
      const result = await promise

      expect(result).toEqual({ recovered: true })
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('attempt 1/3'))
    })

    it('exhausts all retries on persistent 5xx then throws', async () => {
      vi.useFakeTimers()
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      const promise = fetchWithRetry(buildOptions())
      promise.catch(() => {})

      // Advance past first retry delay (1s) and second retry delay (2s)
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.advanceTimersByTimeAsync(2_000)

      await expect(promise).rejects.toThrow('500')
      expect(mockFetch).toHaveBeenCalledTimes(3)
      // stderr written after attempt 1 and attempt 2, not after the final attempt
      expect(stderrSpy).toHaveBeenCalledTimes(2)
    })

    it('uses exponential backoff timing (1s, 2s)', async () => {
      vi.useFakeTimers()
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Error'),
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      const promise = fetchWithRetry(buildOptions())
      // Catch to prevent unhandled rejection
      promise.catch(() => {})

      // Initial call happens immediately
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // At 999ms: first retry delay (1000ms) not yet elapsed
      await vi.advanceTimersByTimeAsync(999)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // At 1000ms: first retry fires
      await vi.advanceTimersByTimeAsync(1)
      expect(mockFetch).toHaveBeenCalledTimes(2)

      // At 2999ms: second retry delay (2000ms) not yet elapsed
      await vi.advanceTimersByTimeAsync(1_999)
      expect(mockFetch).toHaveBeenCalledTimes(2)

      // At 3000ms: second retry fires
      await vi.advanceTimersByTimeAsync(1)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('calls onAuthExpired on 401 and retries due to thrown error being caught', async () => {
      // Note: onAuthExpired() throws inside the try block, which the catch block
      // sees as a retryable error (no response context in catch). This means all
      // 3 attempts run before the error propagates. This is likely a bug in the
      // production code but we test the actual behaviour here.
      vi.useFakeTimers()
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      const onAuthExpired = vi.fn((): never => {
        throw new Error('Auth expired')
      })

      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: false,
          status: 401,
          text: () => Promise.resolve('Unauthorised'),
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      const promise = fetchWithRetry(buildOptions({ onAuthExpired }))
      promise.catch(() => {})

      await vi.advanceTimersByTimeAsync(1_000)
      await vi.advanceTimersByTimeAsync(2_000)

      await expect(promise).rejects.toThrow('Auth expired')
      expect(onAuthExpired).toHaveBeenCalledTimes(3)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('throws RequestTimeoutError on AbortError without retrying', async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new DOMException('signal timed out', 'AbortError'))
      vi.stubGlobal('fetch', mockFetch)

      await expect(fetchWithRetry(buildOptions())).rejects.toThrow(RequestTimeoutError)
      await expect(fetchWithRetry(buildOptions())).rejects.toThrow('timed out')
      // Each call should only attempt once (AbortError is not retryable)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('retries 4xx errors due to throw landing in catch without response context (400)', async () => {
      // Note: 4xx responses trigger `throw lastError` in the try block, which
      // the catch block sees without response context. `isRetryable(error)` with
      // no response returns true, so 4xx errors are retried all 3 attempts.
      // This is likely a bug in the production code but we test actual behaviour.
      vi.useFakeTimers()
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: false,
          status: 400,
          text: () => Promise.resolve('Bad request'),
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      const promise = fetchWithRetry(buildOptions())
      promise.catch(() => {})
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.advanceTimersByTimeAsync(2_000)

      await expect(promise).rejects.toThrow('400')
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('retries 4xx errors due to throw landing in catch without response context (404)', async () => {
      vi.useFakeTimers()
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse({
          ok: false,
          status: 404,
          text: () => Promise.resolve('Not found'),
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      const promise = fetchWithRetry(buildOptions())
      promise.catch(() => {})
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.advanceTimersByTimeAsync(2_000)

      await expect(promise).rejects.toThrow('404')
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('calls buildRequest fresh on each attempt', async () => {
      vi.useFakeTimers()
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      let callCount = 0
      const buildRequest = vi.fn(() => {
        callCount++
        return {
          url: 'https://example.com/api',
          headers: { 'X-Attempt': String(callCount) },
        }
      })

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          mockResponse({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Error'),
          })
        )
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ done: true }),
          })
        )
      vi.stubGlobal('fetch', mockFetch)

      const promise = fetchWithRetry(buildOptions({ buildRequest }))
      await vi.advanceTimersByTimeAsync(1_000)
      await promise

      expect(buildRequest).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://example.com/api',
        expect.objectContaining({ headers: { 'X-Attempt': '1' } })
      )
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://example.com/api',
        expect.objectContaining({ headers: { 'X-Attempt': '2' } })
      )
    })

    it('retries on network error (fetch rejection) then succeeds', async () => {
      vi.useFakeTimers()
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(
          mockResponse({
            ok: true,
            json: () => Promise.resolve({ online: true }),
          })
        )
      vi.stubGlobal('fetch', mockFetch)

      const promise = fetchWithRetry<{ online: boolean }>(buildOptions())
      await vi.advanceTimersByTimeAsync(1_000)
      const result = await promise

      expect(result).toEqual({ online: true })
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })
})
