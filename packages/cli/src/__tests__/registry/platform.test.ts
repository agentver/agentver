import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../registry/config.js', () => ({
  getPlatformUrl: vi.fn(),
}))

vi.mock('../../registry/auth.js', () => ({
  getCredentials: vi.fn(),
}))

vi.mock('@agentver/shared', () => ({
  AgentverError: class AgentverError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
      this.name = 'AgentverError'
    }
  },
}))

describe('registry/platform', () => {
  let platformModule: typeof import('../../registry/platform')
  let configModule: typeof import('../../registry/config')
  let authModule: typeof import('../../registry/auth')

  beforeEach(async () => {
    vi.clearAllMocks()
    platformModule = await import('../../registry/platform')
    configModule = await import('../../registry/config')
    authModule = await import('../../registry/auth')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('platformFetch', () => {
    it('throws when no platform URL configured', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)

      await expect(platformModule.platformFetch('/test')).rejects.toThrow(
        'No platform URL configured'
      )
    })

    it('throws when not authenticated', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://platform.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue(null)

      await expect(platformModule.platformFetch('/test')).rejects.toThrow('Not authenticated')
    })

    it('makes authenticated request with token', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://platform.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'test-token' })

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: 'result' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await platformModule.platformFetch('/test')
      expect(result).toEqual({ data: 'result' })
      expect(mockFetch.mock.calls[0]![0]).toBe('https://platform.com/api/v1/test')
    })

    it('throws on non-OK response', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://platform.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'test-token' })

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: vi.fn().mockResolvedValue('Internal error'),
        })
      )

      await expect(platformModule.platformFetch('/test')).rejects.toThrow('500')
    })
  })

  describe('platformFetchSilent', () => {
    it('returns null on error instead of throwing', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)

      const result = await platformModule.platformFetchSilent('/test')
      expect(result).toBeNull()
    })

    it('returns data on success', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://platform.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'test-token' })

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({ data: 'silent-result' }),
        })
      )

      const result = await platformModule.platformFetchSilent('/test')
      expect(result).toEqual({ data: 'silent-result' })
    })
  })

  describe('isPlatformAvailable', () => {
    it('returns false when no platform URL', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)

      expect(await platformModule.isPlatformAvailable()).toBe(false)
    })

    it('returns true when health check succeeds', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://platform.com')

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

      expect(await platformModule.isPlatformAvailable()).toBe(true)
    })

    it('returns false when health check fails', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://platform.com')

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

      expect(await platformModule.isPlatformAvailable()).toBe(false)
    })

    it('returns false on network error', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://platform.com')

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

      expect(await platformModule.isPlatformAvailable()).toBe(false)
    })
  })
})
