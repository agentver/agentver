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
  })
})
