import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  chmodSync: vi.fn(),
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
    vi.unstubAllEnvs()
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

    it('prefers environment credentials over file credentials', async () => {
      vi.stubEnv('AGENTVER_TOKEN', 'env-token')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: 'file-token' }))

      const result = await authModule.getCredentials()
      expect(result).toEqual({ token: 'env-token' })
      expect(fs.readFileSync).not.toHaveBeenCalled()
    })

    it('reads AGENTVER_API_KEY from the environment', async () => {
      vi.stubEnv('AGENTVER_API_KEY', 'env-api-key')

      const result = await authModule.getCredentials()
      expect(result).toEqual({ apiKey: 'env-api-key' })
    })

    it('returns null when credentials file has invalid shape', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: '' }))

      const result = await authModule.getCredentials()
      expect(result).toBeNull()
    })

    it('returns null on parse error', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('not json')

      const result = await authModule.getCredentials()
      expect(result).toBeNull()
    })

    it('returns null when file contains binary garbage', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        Buffer.from([0x00, 0x89, 0x50, 0x4e, 0x47, 0xff, 0xd8, 0xff]).toString()
      )

      const result = await authModule.getCredentials()
      expect(result).toBeNull()
    })

    it('returns null for truncated JSON', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('{"token":"abc')

      const result = await authModule.getCredentials()
      expect(result).toBeNull()
    })

    it('returns null when file contains an array', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('[]')

      const result = await authModule.getCredentials()
      expect(result).toBeNull()
    })

    it('returns null when file contains null', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('null')

      const result = await authModule.getCredentials()
      expect(result).toBeNull()
    })

    it('returns null when credentials have wrong value types', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ token: 123, apiKey: true }))

      // Zod schema expects strings — wrong types should fail validation
      const result = await authModule.getCredentials()
      expect(result).toBeNull()
    })

    it('returns null when file is empty', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('')

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
        mode: 0o700,
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

    it('rejects empty credentials', () => {
      expect(() => authModule.saveCredentials({ token: '' })).toThrow(
        'Credentials must include a non-empty token or API key.'
      )
    })

    it('saves valid credentials after a corrupt read, producing a readable file', async () => {
      // Simulate a corrupted credentials file
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('corrupted binary garbage')

      const corruptResult = await authModule.getCredentials()
      expect(corruptResult).toBeNull()

      // Now save fresh credentials over the corrupted file
      authModule.saveCredentials({ token: 'fresh-token' })

      // Verify writeFileSync was called with the new credentials
      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string
      const parsed = JSON.parse(writtenContent)
      expect(parsed.token).toBe('fresh-token')

      // Simulate reading back the newly written file
      vi.mocked(fs.readFileSync).mockReturnValue(writtenContent)

      const freshResult = await authModule.getCredentials()
      expect(freshResult).toEqual({ token: 'fresh-token' })
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

    it('rethrows unexpected unlink errors', () => {
      const epermError = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException
      epermError.code = 'EPERM'
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw epermError
      })

      expect(() => authModule.clearCredentials()).toThrow(epermError)
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
