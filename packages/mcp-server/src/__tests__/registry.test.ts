import { AgentverError } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/test'),
}))

describe('registry', () => {
  let fs: typeof import('node:fs')
  let registry: typeof import('../shared/registry')
  let originalRegistryEnv: string | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    originalRegistryEnv = process.env.AGENTVER_REGISTRY
    delete process.env.AGENTVER_REGISTRY
    vi.stubGlobal('fetch', vi.fn())
    fs = await import('node:fs')
    registry = await import('../shared/registry')
  })

  afterEach(() => {
    if (originalRegistryEnv !== undefined) {
      process.env.AGENTVER_REGISTRY = originalRegistryEnv
    } else {
      delete process.env.AGENTVER_REGISTRY
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('getCredentials', () => {
    it('returns null when credentials file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(registry.getCredentials()).toBeNull()
    })

    it('returns null when file contains invalid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('not-json')

      expect(registry.getCredentials()).toBeNull()
    })

    it('returns parsed credentials with token', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: 'my-token' }))

      expect(registry.getCredentials()).toEqual({ token: 'my-token' })
    })

    it('returns parsed credentials with apiKey', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ apiKey: 'my-key' }))

      expect(registry.getCredentials()).toEqual({ apiKey: 'my-key' })
    })

    it('reads from correct path', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      registry.getCredentials()
      expect(fs.existsSync).toHaveBeenCalledWith('/home/test/.agentver/credentials.json')
    })
  })

  describe('isAuthenticated', () => {
    it('returns true when token present', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: 'tok' }))

      expect(registry.isAuthenticated()).toBe(true)
    })

    it('returns true when apiKey present', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ apiKey: 'key' }))

      expect(registry.isAuthenticated()).toBe(true)
    })

    it('returns false when no credentials file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(registry.isAuthenticated()).toBe(false)
    })

    it('returns false when credentials have neither token nor apiKey', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}))

      expect(registry.isAuthenticated()).toBe(false)
    })
  })

  describe('getRegistryUrl', () => {
    it('returns default URL when env unset', () => {
      expect(registry.getRegistryUrl()).toBe('https://app.agentver.com/api/v1')
    })

    it('returns env var value when AGENTVER_REGISTRY is set', () => {
      process.env.AGENTVER_REGISTRY = 'https://custom.registry.com/api'
      expect(registry.getRegistryUrl()).toBe('https://custom.registry.com/api')
    })
  })

  describe('registryFetch', () => {
    function mockCredentials(creds: { token?: string; apiKey?: string }): void {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(creds))
    }

    function mockFetchResponse(body: unknown, status = 200): void {
      vi.mocked(fetch).mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as Response)
    }

    it('makes GET request to correct URL', async () => {
      mockCredentials({ token: 'tok' })
      mockFetchResponse({ data: 'test' })

      await registry.registryFetch('/skills?q=test')

      expect(fetch).toHaveBeenCalledWith(
        'https://app.agentver.com/api/v1/skills?q=test',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('sets Authorization Bearer header when token present', async () => {
      mockCredentials({ token: 'my-token' })
      mockFetchResponse({ data: 'test' })

      await registry.registryFetch('/test')

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-token',
          }),
        })
      )
    })

    it('sets X-API-Key header when apiKey present and no token', async () => {
      mockCredentials({ apiKey: 'my-key' })
      mockFetchResponse({ data: 'test' })

      await registry.registryFetch('/test')

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'my-key',
          }),
        })
      )
    })

    it('sets Content-Type application/json header', async () => {
      mockCredentials({ token: 'tok' })
      mockFetchResponse({ data: 'test' })

      await registry.registryFetch('/test')

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('sends POST body when method and body provided', async () => {
      mockCredentials({ token: 'tok' })
      mockFetchResponse({ data: 'test' })

      await registry.registryFetch('/test', {
        method: 'POST',
        body: { packages: ['a'] },
      })

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ packages: ['a'] }),
        })
      )
    })

    it('returns parsed JSON on success', async () => {
      mockCredentials({ token: 'tok' })
      mockFetchResponse({ results: [1, 2, 3] })

      const result = await registry.registryFetch('/test')
      expect(result).toEqual({ results: [1, 2, 3] })
    })

    it('throws UNAUTHORISED on 401', async () => {
      mockCredentials({ token: 'tok' })
      mockFetchResponse('Unauthorized', 401)

      await expect(registry.registryFetch('/test')).rejects.toThrow(AgentverError)
      await expect(registry.registryFetch('/test')).rejects.toMatchObject({ code: 'UNAUTHORISED' })
    })

    it('throws FORBIDDEN on 403', async () => {
      mockCredentials({ token: 'tok' })
      mockFetchResponse('Forbidden', 403)

      await expect(registry.registryFetch('/test')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('throws NOT_FOUND on 404', async () => {
      mockCredentials({ token: 'tok' })
      mockFetchResponse('Not found', 404)

      await expect(registry.registryFetch('/test')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('throws CONFLICT on 409', async () => {
      mockCredentials({ token: 'tok' })
      mockFetchResponse('Conflict', 409)

      await expect(registry.registryFetch('/test')).rejects.toMatchObject({ code: 'CONFLICT' })
    })

    it('throws RATE_LIMITED on 429', async () => {
      mockCredentials({ token: 'tok' })
      mockFetchResponse('Rate limited', 429)

      await expect(registry.registryFetch('/test')).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    })

    it('throws INTERNAL_ERROR on other non-ok status', async () => {
      mockCredentials({ token: 'tok' })
      mockFetchResponse('Server error', 500)

      await expect(registry.registryFetch('/test')).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
      })
    })

    it('throws INTERNAL_ERROR with timeout message on AbortError', async () => {
      mockCredentials({ token: 'tok' })
      vi.mocked(fetch).mockRejectedValue(new DOMException('Aborted', 'AbortError'))

      await expect(registry.registryFetch('/test')).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        message: expect.stringContaining('timed out'),
      })
    })

    it('throws INTERNAL_ERROR on network error', async () => {
      mockCredentials({ token: 'tok' })
      vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(registry.registryFetch('/test')).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        message: expect.stringContaining('ECONNREFUSED'),
      })
    })
  })
})
