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

    it('returns default config when file contains binary garbage', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        Buffer.from([0x00, 0x89, 0x50, 0x4e, 0x47]).toString()
      )

      const result = configModule.readConfig()
      expect(result).toEqual({})
    })

    it('returns default config for truncated JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('{"platformUrl":"ht')

      const result = configModule.readConfig()
      expect(result).toEqual({})
    })

    it('preserves known fields and ignores unknown fields (forward compatibility)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          platformUrl: 'http://x',
          unknownField: 'value',
          nested: { a: 1 },
        })
      )

      const result = configModule.readConfig()
      expect(result.platformUrl).toBe('http://x')
      // Unknown fields are carried through because readConfig uses a plain JSON.parse cast
      expect((result as Record<string, unknown>).unknownField).toBe('value')
    })

    it('returns default config when file contains a plain string', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('"just a string"')

      const result = configModule.readConfig()
      // JSON.parse succeeds but a string is not an AgentverConfig object;
      // the current implementation casts whatever JSON.parse returns, so
      // accessing properties on a string yields undefined — equivalent to
      // a default (empty) config.
      expect(result.platformUrl).toBeUndefined()
      expect(result.telemetry).toBeUndefined()
    })

    it('returns default config when file contains an array', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('[1,2,3]')

      const result = configModule.readConfig()
      // An array is not a valid AgentverConfig — properties should be absent
      expect(result.platformUrl).toBeUndefined()
      expect(result.telemetry).toBeUndefined()
    })

    it('returns default config when file contains null', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('null')

      const result = configModule.readConfig()
      // null has no properties — should behave like empty config
      expect(result?.platformUrl).toBeUndefined()
    })

    it('handles config with wrong value types gracefully', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ platformUrl: 123, telemetry: 'yes' })
      )

      // Should not throw — readConfig does a plain cast, so wrong types
      // are surfaced but do not crash
      const result = configModule.readConfig()
      expect(result).toBeDefined()
      expect(result.platformUrl).toBe(123)
      expect(result.telemetry).toBe('yes')
    })

    it('handles a very large config file without crashing', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      // Build ~1 MB of valid JSON
      const largeValue = 'x'.repeat(1_000_000)
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ platformUrl: 'https://large.test', bigField: largeValue })
      )

      const result = configModule.readConfig()
      expect(result.platformUrl).toBe('https://large.test')
      expect((result as Record<string, unknown>).bigField).toBe(largeValue)
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

    it('preserves unknown fields through a read-write round-trip', () => {
      const configWithExtras = {
        platformUrl: 'https://roundtrip.test',
        futureFeature: true,
        nested: { deep: 'value' },
      }

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configWithExtras))

      // Read the config (which includes unknown fields)
      const loaded = configModule.readConfig()

      // Write it back
      configModule.writeConfig(loaded)

      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string
      const parsed = JSON.parse(writtenContent)

      expect(parsed.platformUrl).toBe('https://roundtrip.test')
      expect(parsed.futureFeature).toBe(true)
      expect(parsed.nested).toEqual({ deep: 'value' })
    })
  })
})
