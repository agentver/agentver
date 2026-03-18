import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}))

describe('registry/auth', () => {
  let fs: typeof import('node:fs')
  let authModule: typeof import('../../registry/auth')

  beforeEach(async () => {
    vi.clearAllMocks()
    fs = await import('node:fs')
    authModule = await import('../../registry/auth')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getCredentials', () => {
    it('returns null when credentials file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = await authModule.getCredentials()
      expect(result).toBeNull()
    })

    it('returns credentials with token', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: 'my-token' }))

      const result = await authModule.getCredentials()
      expect(result).toEqual({ token: 'my-token' })
    })

    it('returns credentials with apiKey', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ apiKey: 'my-api-key' }))

      const result = await authModule.getCredentials()
      expect(result).toEqual({ apiKey: 'my-api-key' })
    })

    it('returns null on parse error', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('not json')

      const result = await authModule.getCredentials()
      expect(result).toBeNull()
    })
  })

  describe('saveCredentials', () => {
    it('creates directory if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      authModule.saveCredentials({ token: 'test-token' })

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.agentver'), {
        recursive: true,
      })
    })

    it('writes credentials with restricted permissions', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      authModule.saveCredentials({ token: 'test-token' })

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('credentials.json'),
        expect.stringContaining('test-token'),
        { mode: 0o600 }
      )
    })
  })

  describe('clearCredentials', () => {
    it('deletes the credentials file', () => {
      authModule.clearCredentials()

      expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('credentials.json'))
    })

    it('handles gracefully when file does not exist', () => {
      const enoentError = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException
      enoentError.code = 'ENOENT'
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw enoentError
      })

      expect(() => authModule.clearCredentials()).not.toThrow()
    })
  })

  describe('isAuthenticated', () => {
    it('returns true when token exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: 'valid-token' }))

      expect(await authModule.isAuthenticated()).toBe(true)
    })

    it('returns true when apiKey exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ apiKey: 'valid-key' }))

      expect(await authModule.isAuthenticated()).toBe(true)
    })

    it('returns false when no credentials', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(await authModule.isAuthenticated()).toBe(false)
    })

    it('returns false when credentials are empty', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}))

      expect(await authModule.isAuthenticated()).toBe(false)
    })

    it('returns false when credentials have empty string values', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: '', apiKey: '' }))

      expect(await authModule.isAuthenticated()).toBe(false)
    })
  })

  describe('saveCredentials', () => {
    it('stores credentials at the correct path under .agentver', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      authModule.saveCredentials({ token: 'my-token' })

      const writePath = vi.mocked(fs.writeFileSync).mock.calls[0]![0] as string
      expect(writePath).toContain('/home/testuser/.agentver/')
      expect(writePath).toContain('credentials.json')
    })
  })
})
