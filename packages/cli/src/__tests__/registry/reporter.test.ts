import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../registry/config.js', () => ({
  getPlatformUrl: vi.fn(),
}))

vi.mock('../../registry/auth.js', () => ({
  getCredentials: vi.fn(),
}))

vi.mock('node:os', () => ({
  hostname: vi.fn(() => 'test-machine'),
}))

describe('registry/reporter', () => {
  let reporterModule: typeof import('../../registry/reporter')
  let configModule: typeof import('../../registry/config')
  let authModule: typeof import('../../registry/auth')

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    reporterModule = await import('../../registry/reporter')
    configModule = await import('../../registry/config')
    authModule = await import('../../registry/auth')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('reportInstallation', () => {
    it('does nothing when no platform URL is configured', () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)

      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      reporterModule.reportInstallation(
        'my-skill',
        { type: 'git' as const, uri: 'test', path: '', ref: 'main', commit: 'abc1234' },
        ['claude'],
        'sha-123'
      )

      // fetch should not be called because no platform URL
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('fires and forgets the installation report', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://platform.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'test-token' })

      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      reporterModule.reportInstallation(
        'my-skill',
        { type: 'git' as const, uri: 'test', path: '', ref: 'main', commit: 'abc1234' },
        ['claude'],
        'sha-123'
      )

      // Need to flush microtasks to resolve the async IIFE
      await vi.advanceTimersByTimeAsync(0)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://platform.com/api/v1/installations',
        expect.objectContaining({
          method: 'POST',
        })
      )
    })
  })

  describe('reportRemoval', () => {
    it('does nothing when no platform URL is configured', () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue(null)

      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      reporterModule.reportRemoval('my-skill')

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('sends DELETE request for the package', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://platform.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'test-token' })

      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      reporterModule.reportRemoval('my-skill')

      await vi.advanceTimersByTimeAsync(0)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://platform.com/api/v1/installations/my-skill',
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })

    it('does not throw on network error', async () => {
      vi.mocked(configModule.getPlatformUrl).mockReturnValue('https://platform.com')
      vi.mocked(authModule.getCredentials).mockResolvedValue({ token: 'test-token' })

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

      // Should not throw — fire and forget
      expect(() => reporterModule.reportRemoval('my-skill')).not.toThrow()
      await vi.advanceTimersByTimeAsync(0)
    })
  })
})
