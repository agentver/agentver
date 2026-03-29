import { describe, expect, it } from 'vitest'

import {
  bundleCredentialDefinitionSchema,
  bundleManifestSchema,
  bundlePackageRefSchema,
  credentialSharingSchema,
  credentialSourceSchema,
  mcpCredentialRequirementSchema,
  mcpServerConfigSchema,
  mcpServerEntrySchema,
  mcpServerSourceSchema,
  mcpServersFormatSchema,
  mcpTransportSchema,
  vscodeServerEntrySchema,
  vscodeServersFormatSchema,
} from '../mcp-schemas'

// ---------------------------------------------------------------------------
// Helpers — reusable valid objects
// ---------------------------------------------------------------------------

const validNpmSource = {
  type: 'npm' as const,
  package: '@scope/server',
  version: '1.0.0',
}

const validGitSource = {
  type: 'git' as const,
  uri: 'https://github.com/org/repo',
  ref: 'main',
}

const validDockerSource = {
  type: 'docker' as const,
  image: 'ghcr.io/org/server',
  tag: 'latest',
}

const validUrlSource = {
  type: 'url' as const,
  url: 'https://example.com/server.js',
}

const validLocalSource = {
  type: 'local' as const,
  path: '/usr/local/bin/server',
}

const validCredentialRequirement = {
  key: 'API_KEY',
  description: 'API key for service',
  source: 'env' as const,
  required: true,
}

const validServerConfig = {
  name: 'my-server',
  transport: 'stdio' as const,
  command: 'node',
  args: ['server.js'],
}

const validBundleManifest = {
  name: 'my-bundle',
  version: '1.0.0',
}

// ---------------------------------------------------------------------------
// mcpTransportSchema
// ---------------------------------------------------------------------------

describe('mcpTransportSchema', () => {
  it.each(['stdio', 'http', 'sse'])('should accept valid transport "%s"', (value) => {
    expect(mcpTransportSchema.parse(value)).toBe(value)
  })

  it('should reject invalid transport string', () => {
    const result = mcpTransportSchema.safeParse('websocket')
    expect(result.success).toBe(false)
  })

  it('should reject empty string', () => {
    const result = mcpTransportSchema.safeParse('')
    expect(result.success).toBe(false)
  })

  it('should reject non-string value', () => {
    const result = mcpTransportSchema.safeParse(42)
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// credentialSourceSchema
// ---------------------------------------------------------------------------

describe('credentialSourceSchema', () => {
  it.each(['vault', 'prompt', 'env', 'oauth'])('should accept valid source "%s"', (value) => {
    expect(credentialSourceSchema.parse(value)).toBe(value)
  })

  it('should reject invalid source string', () => {
    const result = credentialSourceSchema.safeParse('file')
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// credentialSharingSchema
// ---------------------------------------------------------------------------

describe('credentialSharingSchema', () => {
  it.each(['individual', 'team', 'org'])('should accept valid sharing mode "%s"', (value) => {
    expect(credentialSharingSchema.parse(value)).toBe(value)
  })

  it('should reject invalid sharing mode', () => {
    const result = credentialSharingSchema.safeParse('global')
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// mcpCredentialRequirementSchema
// ---------------------------------------------------------------------------

describe('mcpCredentialRequirementSchema', () => {
  it('should accept valid minimal object', () => {
    const result = mcpCredentialRequirementSchema.parse({
      key: 'API_KEY',
      description: 'API key',
      source: 'env',
    })
    expect(result.key).toBe('API_KEY')
    expect(result.required).toBe(true)
  })

  it('should accept all optional fields', () => {
    const result = mcpCredentialRequirementSchema.parse({
      ...validCredentialRequirement,
      vaultKey: 'secrets/api-key',
      envVar: 'MY_API_KEY',
      oauthProvider: 'github',
    })
    expect(result.vaultKey).toBe('secrets/api-key')
    expect(result.envVar).toBe('MY_API_KEY')
    expect(result.oauthProvider).toBe('github')
  })

  it('should default required to true when omitted', () => {
    const result = mcpCredentialRequirementSchema.parse({
      key: 'TOKEN',
      description: 'A token',
      source: 'vault',
    })
    expect(result.required).toBe(true)
  })

  it('should accept required: false explicitly', () => {
    const result = mcpCredentialRequirementSchema.parse({
      key: 'TOKEN',
      description: 'A token',
      source: 'vault',
      required: false,
    })
    expect(result.required).toBe(false)
  })

  it('should reject empty key', () => {
    const result = mcpCredentialRequirementSchema.safeParse({
      key: '',
      description: 'desc',
      source: 'env',
    })
    expect(result.success).toBe(false)
  })

  it('should reject key exceeding 128 chars', () => {
    const result = mcpCredentialRequirementSchema.safeParse({
      key: 'x'.repeat(129),
      description: 'desc',
      source: 'env',
    })
    expect(result.success).toBe(false)
  })

  it('should reject description exceeding 500 chars', () => {
    const result = mcpCredentialRequirementSchema.safeParse({
      key: 'KEY',
      description: 'x'.repeat(501),
      source: 'env',
    })
    expect(result.success).toBe(false)
  })

  it('should reject empty vaultKey when provided', () => {
    const result = mcpCredentialRequirementSchema.safeParse({
      ...validCredentialRequirement,
      vaultKey: '',
    })
    expect(result.success).toBe(false)
  })

  it('should reject empty envVar when provided', () => {
    const result = mcpCredentialRequirementSchema.safeParse({
      ...validCredentialRequirement,
      envVar: '',
    })
    expect(result.success).toBe(false)
  })

  it('should reject oauthProvider exceeding 64 chars', () => {
    const result = mcpCredentialRequirementSchema.safeParse({
      ...validCredentialRequirement,
      oauthProvider: 'x'.repeat(65),
    })
    expect(result.success).toBe(false)
  })

  it('should reject missing key field', () => {
    const result = mcpCredentialRequirementSchema.safeParse({
      description: 'desc',
      source: 'env',
    })
    expect(result.success).toBe(false)
  })

  it('should reject missing description field', () => {
    const result = mcpCredentialRequirementSchema.safeParse({
      key: 'KEY',
      source: 'env',
    })
    expect(result.success).toBe(false)
  })

  it('should reject missing source field', () => {
    const result = mcpCredentialRequirementSchema.safeParse({
      key: 'KEY',
      description: 'desc',
    })
    expect(result.success).toBe(false)
  })

  it('should reject invalid source value', () => {
    const result = mcpCredentialRequirementSchema.safeParse({
      key: 'KEY',
      description: 'desc',
      source: 'invalid',
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// mcpServerSourceSchema (discriminated union)
// ---------------------------------------------------------------------------

describe('mcpServerSourceSchema', () => {
  describe('npm source', () => {
    it('should accept valid npm source with package and version', () => {
      const result = mcpServerSourceSchema.parse(validNpmSource)
      expect(result.type).toBe('npm')
      expect(result).toHaveProperty('package', '@scope/server')
    })

    it('should accept npm source without optional version', () => {
      const result = mcpServerSourceSchema.parse({ type: 'npm', package: '@scope/server' })
      expect(result.type).toBe('npm')
    })

    it('should reject npm source with empty package', () => {
      const result = mcpServerSourceSchema.safeParse({ type: 'npm', package: '' })
      expect(result.success).toBe(false)
    })
  })

  describe('git source', () => {
    it('should accept valid git source with uri and ref', () => {
      const result = mcpServerSourceSchema.parse(validGitSource)
      expect(result.type).toBe('git')
      expect(result).toHaveProperty('uri', 'https://github.com/org/repo')
    })

    it('should accept git source without optional ref', () => {
      const result = mcpServerSourceSchema.parse({
        type: 'git',
        uri: 'https://github.com/org/repo',
      })
      expect(result.type).toBe('git')
    })

    it('should reject git source with empty uri', () => {
      const result = mcpServerSourceSchema.safeParse({ type: 'git', uri: '' })
      expect(result.success).toBe(false)
    })
  })

  describe('docker source', () => {
    it('should accept valid docker source with image and tag', () => {
      const result = mcpServerSourceSchema.parse(validDockerSource)
      expect(result.type).toBe('docker')
      expect(result).toHaveProperty('image', 'ghcr.io/org/server')
    })

    it('should reject docker source with empty image', () => {
      const result = mcpServerSourceSchema.safeParse({ type: 'docker', image: '' })
      expect(result.success).toBe(false)
    })
  })

  describe('url source', () => {
    it('should accept valid url source', () => {
      const result = mcpServerSourceSchema.parse(validUrlSource)
      expect(result.type).toBe('url')
      expect(result).toHaveProperty('url', 'https://example.com/server.js')
    })

    it('should reject url source with invalid URL format', () => {
      const result = mcpServerSourceSchema.safeParse({ type: 'url', url: 'not-a-url' })
      expect(result.success).toBe(false)
    })
  })

  describe('local source', () => {
    it('should accept valid local source', () => {
      const result = mcpServerSourceSchema.parse(validLocalSource)
      expect(result.type).toBe('local')
      expect(result).toHaveProperty('path', '/usr/local/bin/server')
    })

    it('should reject local source with empty path', () => {
      const result = mcpServerSourceSchema.safeParse({ type: 'local', path: '' })
      expect(result.success).toBe(false)
    })
  })

  it('should reject source with unknown type', () => {
    const result = mcpServerSourceSchema.safeParse({ type: 'pypi', package: 'server' })
    expect(result.success).toBe(false)
  })

  it('should reject source with missing type field', () => {
    const result = mcpServerSourceSchema.safeParse({ package: '@scope/server' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// mcpServerConfigSchema
// ---------------------------------------------------------------------------

describe('mcpServerConfigSchema', () => {
  it('should accept valid minimal config', () => {
    const result = mcpServerConfigSchema.parse({
      name: 'my-server',
      command: 'node',
    })
    expect(result.name).toBe('my-server')
    expect(result.transport).toBe('stdio')
  })

  it('should accept config with all optional fields', () => {
    const result = mcpServerConfigSchema.parse({
      name: 'my-server',
      description: 'A test server',
      source: validNpmSource,
      transport: 'http',
      command: 'node',
      args: ['server.js'],
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
      env: { NODE_ENV: 'production' },
      credentials: [validCredentialRequirement],
    })
    expect(result.description).toBe('A test server')
    expect(result.transport).toBe('http')
    expect(result.credentials).toHaveLength(1)
  })

  it('should default transport to stdio when omitted', () => {
    const result = mcpServerConfigSchema.parse({ name: 'my-server' })
    expect(result.transport).toBe('stdio')
  })

  it.each([
    'stdio',
    'http',
    'sse',
  ] as const)('should accept transport "%s" explicitly', (transport) => {
    const result = mcpServerConfigSchema.parse({ name: 'my-server', transport })
    expect(result.transport).toBe(transport)
  })

  it('should reject empty name', () => {
    const result = mcpServerConfigSchema.safeParse({ name: '' })
    expect(result.success).toBe(false)
  })

  it('should reject name exceeding 64 chars', () => {
    const result = mcpServerConfigSchema.safeParse({ name: 'a'.repeat(65) })
    expect(result.success).toBe(false)
  })

  it('should reject name with uppercase letters', () => {
    const result = mcpServerConfigSchema.safeParse({ name: 'MyServer' })
    expect(result.success).toBe(false)
  })

  it('should reject name starting with hyphen', () => {
    const result = mcpServerConfigSchema.safeParse({ name: '-server' })
    expect(result.success).toBe(false)
  })

  it('should reject name ending with hyphen', () => {
    const result = mcpServerConfigSchema.safeParse({ name: 'server-' })
    expect(result.success).toBe(false)
  })

  it('should reject name with spaces', () => {
    const result = mcpServerConfigSchema.safeParse({ name: 'my server' })
    expect(result.success).toBe(false)
  })

  it('should reject name with underscores', () => {
    const result = mcpServerConfigSchema.safeParse({ name: 'my_server' })
    expect(result.success).toBe(false)
  })

  it.each(['a', 'my-server', 's3', 'a1b2'])('should accept valid name "%s"', (name) => {
    const result = mcpServerConfigSchema.parse({ name })
    expect(result.name).toBe(name)
  })

  it('should accept description up to 500 chars', () => {
    const result = mcpServerConfigSchema.parse({ name: 'my-server', description: 'x'.repeat(500) })
    expect(result.description).toHaveLength(500)
  })

  it('should reject description exceeding 500 chars', () => {
    const result = mcpServerConfigSchema.safeParse({
      name: 'my-server',
      description: 'x'.repeat(501),
    })
    expect(result.success).toBe(false)
  })

  it('should accept nested npm source', () => {
    const result = mcpServerConfigSchema.parse({
      name: 'my-server',
      source: validNpmSource,
    })
    expect(result.source?.type).toBe('npm')
  })

  it('should accept credentials array', () => {
    const result = mcpServerConfigSchema.parse({
      name: 'my-server',
      credentials: [validCredentialRequirement],
    })
    expect(result.credentials).toHaveLength(1)
  })

  it('should accept url and headers for http transport', () => {
    const result = mcpServerConfigSchema.parse({
      name: 'my-server',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { 'X-Custom': 'value' },
    })
    expect(result.url).toBe('https://example.com/mcp')
    expect(result.headers).toEqual({ 'X-Custom': 'value' })
  })

  it('should accept env record', () => {
    const result = mcpServerConfigSchema.parse({
      name: 'my-server',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: testing credential placeholder syntax
      env: { API_KEY: '${credentials.api-key}' },
    })
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing credential placeholder syntax
    expect(result.env).toEqual({ API_KEY: '${credentials.api-key}' })
  })
})

// ---------------------------------------------------------------------------
// bundleCredentialDefinitionSchema
// ---------------------------------------------------------------------------

describe('bundleCredentialDefinitionSchema', () => {
  it('should accept valid minimal object with defaults', () => {
    const result = bundleCredentialDefinitionSchema.parse({ description: 'API key' })
    expect(result.required).toBe(true)
    expect(result.sharing).toBe('individual')
  })

  it('should default required to true', () => {
    const result = bundleCredentialDefinitionSchema.parse({ description: 'desc' })
    expect(result.required).toBe(true)
  })

  it('should default sharing to individual', () => {
    const result = bundleCredentialDefinitionSchema.parse({ description: 'desc' })
    expect(result.sharing).toBe('individual')
  })

  it.each(['team', 'org'] as const)('should accept sharing mode "%s"', (sharing) => {
    const result = bundleCredentialDefinitionSchema.parse({ description: 'desc', sharing })
    expect(result.sharing).toBe(sharing)
  })

  it('should accept rotationDays as positive integer', () => {
    const result = bundleCredentialDefinitionSchema.parse({
      description: 'desc',
      rotationDays: 30,
    })
    expect(result.rotationDays).toBe(30)
  })

  it('should reject rotationDays of 0', () => {
    const result = bundleCredentialDefinitionSchema.safeParse({
      description: 'desc',
      rotationDays: 0,
    })
    expect(result.success).toBe(false)
  })

  it('should reject negative rotationDays', () => {
    const result = bundleCredentialDefinitionSchema.safeParse({
      description: 'desc',
      rotationDays: -1,
    })
    expect(result.success).toBe(false)
  })

  it('should reject non-integer rotationDays', () => {
    const result = bundleCredentialDefinitionSchema.safeParse({
      description: 'desc',
      rotationDays: 30.5,
    })
    expect(result.success).toBe(false)
  })

  it('should reject description exceeding 500 chars', () => {
    const result = bundleCredentialDefinitionSchema.safeParse({
      description: 'x'.repeat(501),
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// bundlePackageRefSchema
// ---------------------------------------------------------------------------

describe('bundlePackageRefSchema', () => {
  it('should accept valid minimal ref (name only)', () => {
    const result = bundlePackageRefSchema.parse({ name: 'my-package' })
    expect(result.name).toBe('my-package')
    expect(result.optional).toBe(false)
  })

  it('should default optional to false', () => {
    const result = bundlePackageRefSchema.parse({ name: 'pkg' })
    expect(result.optional).toBe(false)
  })

  it('should accept optional: true', () => {
    const result = bundlePackageRefSchema.parse({ name: 'pkg', optional: true })
    expect(result.optional).toBe(true)
  })

  it('should accept with version string', () => {
    const result = bundlePackageRefSchema.parse({ name: 'pkg', version: '1.0.0' })
    expect(result.version).toBe('1.0.0')
  })

  it('should reject empty name', () => {
    const result = bundlePackageRefSchema.safeParse({ name: '' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// bundleManifestSchema
// ---------------------------------------------------------------------------

describe('bundleManifestSchema', () => {
  it('should accept valid minimal manifest', () => {
    const result = bundleManifestSchema.parse(validBundleManifest)
    expect(result.name).toBe('my-bundle')
    expect(result.version).toBe('1.0.0')
  })

  it('should accept manifest with all optional fields', () => {
    const result = bundleManifestSchema.parse({
      ...validBundleManifest,
      description: 'A test bundle',
      extends: 'base-bundle',
      includes: {
        skills: [{ name: 'skill-a' }],
        prompts: [{ name: 'prompt-a' }],
        rules: [{ name: 'rule-a' }],
        plugins: [{ name: 'plugin-a' }],
        scripts: [{ name: 'script-a' }],
      },
      mcpServers: [validServerConfig],
      credentials: {
        'api-key': { description: 'API key' },
      },
    })
    expect(result.description).toBe('A test bundle')
    expect(result.extends).toBe('base-bundle')
    expect(result.includes?.skills).toHaveLength(1)
    expect(result.includes?.prompts).toHaveLength(1)
    expect(result.includes?.rules).toHaveLength(1)
    expect(result.includes?.plugins).toHaveLength(1)
    expect(result.includes?.scripts).toHaveLength(1)
    expect(result.mcpServers).toHaveLength(1)
    expect(result.credentials?.['api-key']).toBeDefined()
  })

  it('should reject empty name', () => {
    const result = bundleManifestSchema.safeParse({ name: '', version: '1.0.0' })
    expect(result.success).toBe(false)
  })

  it('should reject name exceeding 64 chars', () => {
    const result = bundleManifestSchema.safeParse({ name: 'a'.repeat(65), version: '1.0.0' })
    expect(result.success).toBe(false)
  })

  it('should reject name failing regex (uppercase)', () => {
    const result = bundleManifestSchema.safeParse({ name: 'MyBundle', version: '1.0.0' })
    expect(result.success).toBe(false)
  })

  it('should reject name failing regex (starts with hyphen)', () => {
    const result = bundleManifestSchema.safeParse({ name: '-bundle', version: '1.0.0' })
    expect(result.success).toBe(false)
  })

  it.each(['my-bundle', 'a', 'a1b2'])('should accept valid name "%s"', (name) => {
    const result = bundleManifestSchema.parse({ name, version: '1.0.0' })
    expect(result.name).toBe(name)
  })

  it.each([
    '1.0.0',
    '0.1.0-alpha',
    '2.3.4-beta.1',
    '1.0.0+build.123',
    '1.0.0-beta.1+sha.abc123',
  ])('should accept valid semver "%s"', (version) => {
    const result = bundleManifestSchema.parse({ name: 'my-bundle', version })
    expect(result.version).toBe(version)
  })

  it.each([
    '1.0',
    'abc',
    'v1.0.0',
    '01.0.0',
    '0.01.0',
    '0.0.01',
  ])('should reject invalid semver "%s"', (version) => {
    const result = bundleManifestSchema.safeParse({ name: 'my-bundle', version })
    expect(result.success).toBe(false)
  })

  it('should reject description exceeding 1000 chars', () => {
    const result = bundleManifestSchema.safeParse({
      ...validBundleManifest,
      description: 'x'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })

  it('should accept empty includes object', () => {
    const result = bundleManifestSchema.parse({ ...validBundleManifest, includes: {} })
    expect(result.includes).toBeDefined()
  })

  it('should accept empty mcpServers array', () => {
    const result = bundleManifestSchema.parse({ ...validBundleManifest, mcpServers: [] })
    expect(result.mcpServers).toEqual([])
  })

  it('should accept includes with bundlePackageRef objects', () => {
    const result = bundleManifestSchema.parse({
      ...validBundleManifest,
      includes: {
        skills: [{ name: 'my-skill', version: '1.0.0', optional: true }],
      },
    })
    expect(result.includes?.skills?.[0]).toEqual({
      name: 'my-skill',
      version: '1.0.0',
      optional: true,
    })
  })
})

// ---------------------------------------------------------------------------
// mcpServerEntrySchema
// ---------------------------------------------------------------------------

describe('mcpServerEntrySchema', () => {
  it('should accept valid entry with command and args', () => {
    const result = mcpServerEntrySchema.parse({
      command: 'node',
      args: ['server.js'],
    })
    expect(result.command).toBe('node')
    expect(result.args).toEqual(['server.js'])
  })

  it('should accept entry with url and headers', () => {
    const result = mcpServerEntrySchema.parse({
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
    })
    expect(result.url).toBe('https://example.com/mcp')
  })

  it('should accept entry with env record', () => {
    const result = mcpServerEntrySchema.parse({
      command: 'node',
      env: { NODE_ENV: 'production' },
    })
    expect(result.env).toEqual({ NODE_ENV: 'production' })
  })

  it('should accept empty object (all fields optional)', () => {
    const result = mcpServerEntrySchema.parse({})
    expect(result).toEqual({})
  })

  it('should accept any string for url (no URL validation)', () => {
    const result = mcpServerEntrySchema.parse({ url: 'not-a-real-url' })
    expect(result.url).toBe('not-a-real-url')
  })
})

// ---------------------------------------------------------------------------
// mcpServersFormatSchema
// ---------------------------------------------------------------------------

describe('mcpServersFormatSchema', () => {
  it('should accept valid format with one server entry', () => {
    const result = mcpServersFormatSchema.parse({
      mcpServers: {
        'my-server': { command: 'node', args: ['server.js'] },
      },
    })
    expect(result.mcpServers['my-server']).toBeDefined()
  })

  it('should accept valid format with multiple server entries', () => {
    const result = mcpServersFormatSchema.parse({
      mcpServers: {
        server1: { command: 'node', args: ['a.js'] },
        server2: { command: 'python', args: ['b.py'] },
      },
    })
    expect(Object.keys(result.mcpServers)).toHaveLength(2)
  })

  it('should accept format with empty mcpServers record', () => {
    const result = mcpServersFormatSchema.parse({ mcpServers: {} })
    expect(result.mcpServers).toEqual({})
  })

  it('should reject missing mcpServers key', () => {
    const result = mcpServersFormatSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// vscodeServerEntrySchema
// ---------------------------------------------------------------------------

describe('vscodeServerEntrySchema', () => {
  it('should accept valid entry and default type to stdio', () => {
    const result = vscodeServerEntrySchema.parse({
      command: 'node',
      args: ['server.js'],
    })
    expect(result.type).toBe('stdio')
    expect(result.command).toBe('node')
  })

  it('should accept type: sse explicitly', () => {
    const result = vscodeServerEntrySchema.parse({
      command: 'node',
      type: 'sse',
    })
    expect(result.type).toBe('sse')
  })

  it('should reject type: http (only stdio and sse allowed)', () => {
    const result = vscodeServerEntrySchema.safeParse({
      command: 'node',
      type: 'http',
    })
    expect(result.success).toBe(false)
  })

  it('should inherit fields from mcpServerEntrySchema', () => {
    const result = vscodeServerEntrySchema.parse({
      command: 'node',
      args: ['server.js'],
      env: { KEY: 'val' },
      url: 'some-url',
      headers: { 'X-Custom': 'value' },
    })
    expect(result.command).toBe('node')
    expect(result.args).toEqual(['server.js'])
    expect(result.env).toEqual({ KEY: 'val' })
    expect(result.url).toBe('some-url')
    expect(result.headers).toEqual({ 'X-Custom': 'value' })
  })
})

// ---------------------------------------------------------------------------
// vscodeServersFormatSchema
// ---------------------------------------------------------------------------

describe('vscodeServersFormatSchema', () => {
  it('should accept valid format with servers record', () => {
    const result = vscodeServersFormatSchema.parse({
      servers: {
        'my-server': { command: 'node', args: ['server.js'] },
      },
    })
    expect(result.servers['my-server']).toBeDefined()
    expect(result.servers['my-server'].type).toBe('stdio')
  })

  it('should reject missing servers key', () => {
    const result = vscodeServersFormatSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})
