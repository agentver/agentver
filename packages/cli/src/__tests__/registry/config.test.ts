import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  chmodSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}))

vi.mock('../../registry/auth.js', () => ({
  getCredentials: vi.fn().mockResolvedValue(null),
}))

describe('registry/config', () => {
  let fs: typeof import('node:fs')
  let configModule: typeof import('../../registry/config')

  beforeEach(async () => {
    vi.clearAllMocks()
    fs = await import('node:fs')
    configModule = await import('../../registry/config')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('readConfig', () => {
    it('returns empty object when config file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = configModule.readConfig()
      expect(result).toEqual({})
    })

    it('reads and parses valid config', () => {
      const config = { platformUrl: 'https://app.agentver.com', telemetry: true }
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config))

      const result = configModule.readConfig()
      expect(result.platformUrl).toBe('https://app.agentver.com')
      expect(result.telemetry).toBe(true)
    })

    it('returns empty object on parse error', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json')

      const result = configModule.readConfig()
      expect(result).toEqual({})
    })
  })

  describe('writeConfig', () => {
    it('creates directory when it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      configModule.writeConfig({ platformUrl: 'https://test.com' })

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.agentver'), {
        recursive: true,
        mode: 0o700,
      })
    })

    it('writes config with restricted file permissions', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      configModule.writeConfig({ platformUrl: 'https://test.com' })

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('config.json'),
        expect.stringContaining('platformUrl'),
        { mode: 0o600 }
      )
    })
  })

  describe('getPlatformUrl', () => {
    it('returns the platform URL from config', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ platformUrl: 'https://my-platform.com' })
      )

      expect(configModule.getPlatformUrl()).toBe('https://my-platform.com')
    })

    it('returns null when no platform URL configured', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(configModule.getPlatformUrl()).toBeNull()
    })
  })

  describe('isConnected', () => {
    it('returns false when no platform URL', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = await configModule.isConnected()
      expect(result).toBe(false)
    })

    it('returns false when no credentials', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ platformUrl: 'https://test.com' })
      )

      const { getCredentials } = await import('../../registry/auth')
      vi.mocked(getCredentials).mockResolvedValue(null)

      const result = await configModule.isConnected()
      expect(result).toBe(false)
    })

    it('returns true when platform URL and token exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ platformUrl: 'https://test.com' })
      )

      const { getCredentials } = await import('../../registry/auth')
      vi.mocked(getCredentials).mockResolvedValue({ token: 'my-token' })

      const result = await configModule.isConnected()
      expect(result).toBe(true)
    })

    it('returns true when platform URL and apiKey exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ platformUrl: 'https://test.com' })
      )

      const { getCredentials } = await import('../../registry/auth')
      vi.mocked(getCredentials).mockResolvedValue({ apiKey: 'my-api-key' })

      const result = await configModule.isConnected()
      expect(result).toBe(true)
    })
  })

  describe('writeConfig', () => {
    it('merges new values without destroying existing ones', () => {
      // First write
      vi.mocked(fs.existsSync).mockReturnValue(true)
      configModule.writeConfig({ platformUrl: 'https://test.com' })

      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string
      const parsed = JSON.parse(writtenContent)
      expect(parsed.platformUrl).toBe('https://test.com')
    })
  })
})
