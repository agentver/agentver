import type { BundleManifest } from '@agentver/shared'
import { describe, expect, it } from 'vitest'
import { resolveBundle, validateBundleManifest } from '../../bundle/resolver'

function createMinimalManifest(overrides?: Partial<BundleManifest>): BundleManifest {
  return {
    name: 'test-bundle',
    version: '1.0.0',
    ...overrides,
  }
}

describe('resolveBundle', () => {
  it('returns empty packages when no includes specified', () => {
    const result = resolveBundle(createMinimalManifest())
    expect(result.name).toBe('test-bundle')
    expect(result.version).toBe('1.0.0')
    expect(result.packages).toEqual([])
    expect(result.mcpServers).toEqual([])
    expect(result.credentials.size).toBe(0)
  })

  it('resolves skills, prompts, rules, plugins, and scripts from includes', () => {
    const manifest = createMinimalManifest({
      includes: {
        skills: [
          { name: 'google-search', optional: false },
          { name: 'seo-audit', version: '2.0.0', optional: true },
        ],
        prompts: [{ name: 'pr-review', optional: false }],
        rules: [{ name: 'no-console', optional: false }],
        plugins: [{ name: 'eslint-plugin', optional: false }],
        scripts: [{ name: 'deploy-check', optional: false }],
      },
    })

    const result = resolveBundle(manifest)
    expect(result.packages).toHaveLength(6)

    expect(result.packages[0]).toEqual({
      name: 'google-search',
      version: undefined,
      type: 'skill',
      optional: false,
    })

    expect(result.packages[1]).toEqual({
      name: 'seo-audit',
      version: '2.0.0',
      type: 'skill',
      optional: true,
    })

    expect(result.packages[2]).toEqual({
      name: 'pr-review',
      version: undefined,
      type: 'prompt',
      optional: false,
    })

    expect(result.packages[3]).toEqual({
      name: 'no-console',
      version: undefined,
      type: 'rule',
      optional: false,
    })

    expect(result.packages[4]).toEqual({
      name: 'eslint-plugin',
      version: undefined,
      type: 'plugin',
      optional: false,
    })

    expect(result.packages[5]).toEqual({
      name: 'deploy-check',
      version: undefined,
      type: 'script',
      optional: false,
    })
  })

  it('resolves top-level credential definitions', () => {
    const manifest = createMinimalManifest({
      credentials: {
        'openai-key': {
          description: 'OpenAI API Key',
          required: true,
          sharing: 'individual',
        },
        'slack-token': {
          description: 'Slack Bot Token',
          required: false,
          sharing: 'team',
        },
      },
    })

    const result = resolveBundle(manifest)
    expect(result.credentials.size).toBe(2)

    const openaiCred = result.credentials.get('openai-key')
    expect(openaiCred).toBeDefined()
    expect(openaiCred!.source).toBe('vault')
    expect(openaiCred!.required).toBe(true)
    expect(openaiCred!.sharing).toBe('individual')

    const slackCred = result.credentials.get('slack-token')
    expect(slackCred).toBeDefined()
    expect(slackCred!.required).toBe(false)
    expect(slackCred!.sharing).toBe('team')
  })

  it('resolves MCP servers with credentials', () => {
    const manifest = createMinimalManifest({
      credentials: {
        'api-key': {
          description: 'API Key',
          required: true,
          sharing: 'team',
        },
      },
      mcpServers: [
        {
          name: 'test-server',
          description: 'A test server',
          transport: 'stdio',
          command: 'npx',
          args: ['@test/server'],
          // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional credential reference syntax
          env: { API_KEY: '${credentials.api-key}' },
          credentials: [
            {
              key: 'api-key',
              source: 'vault',
              vaultKey: 'api-key',
              description: 'API Key',
              required: true,
            },
          ],
        },
      ],
    })

    const result = resolveBundle(manifest)
    expect(result.mcpServers).toHaveLength(1)

    const server = result.mcpServers[0]!
    expect(server.name).toBe('test-server')
    expect(server.command).toBe('npx')
    expect(server.args).toEqual(['@test/server'])
    expect(server.credentials).toHaveLength(1)
    expect(server.credentials[0]!.sharing).toBe('team') // Merged from top-level
  })

  it('preserves extends field', () => {
    const manifest = createMinimalManifest({ extends: 'base-bundle' })
    const result = resolveBundle(manifest)
    expect(result.extends).toBe('base-bundle')
  })
})

describe('validateBundleManifest', () => {
  it('returns no errors for valid manifest', () => {
    const manifest = createMinimalManifest({
      mcpServers: [
        {
          name: 'valid-server',
          transport: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
      ],
    })
    expect(validateBundleManifest(manifest)).toEqual([])
  })

  it('detects missing command for stdio transport', () => {
    const manifest = createMinimalManifest({
      mcpServers: [
        {
          name: 'bad-server',
          transport: 'stdio',
        },
      ],
    })
    const errors = validateBundleManifest(manifest)
    expect(errors).toContain('MCP server "bad-server": stdio transport requires a command')
  })

  it('detects missing url for http transport', () => {
    const manifest = createMinimalManifest({
      mcpServers: [
        {
          name: 'bad-http',
          transport: 'http',
        },
      ],
    })
    const errors = validateBundleManifest(manifest)
    expect(errors).toContain('MCP server "bad-http": http transport requires a url')
  })

  it('detects missing url for sse transport', () => {
    const manifest = createMinimalManifest({
      mcpServers: [
        {
          name: 'bad-sse',
          transport: 'sse',
        },
      ],
    })
    const errors = validateBundleManifest(manifest)
    expect(errors).toContain('MCP server "bad-sse": sse transport requires a url')
  })

  it('detects undefined credential references in env vars', () => {
    const manifest = createMinimalManifest({
      mcpServers: [
        {
          name: 'env-server',
          transport: 'stdio',
          command: 'node',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional credential reference syntax
          env: { TOKEN: '${credentials.missing-key}' },
        },
      ],
    })
    const errors = validateBundleManifest(manifest)
    expect(errors).toContain(
      'MCP server "env-server": env var "TOKEN" references credential "missing-key" which is not defined'
    )
  })

  it('does not flag env var references that exist in top-level credentials', () => {
    const manifest = createMinimalManifest({
      credentials: {
        'my-key': {
          description: 'Key',
          required: true,
          sharing: 'individual',
        },
      },
      mcpServers: [
        {
          name: 'env-server',
          transport: 'stdio',
          command: 'node',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional credential reference syntax
          env: { TOKEN: '${credentials.my-key}' },
        },
      ],
    })
    const errors = validateBundleManifest(manifest)
    expect(errors).toEqual([])
  })

  it('returns no errors for manifest with no MCP servers', () => {
    const manifest = createMinimalManifest()
    expect(validateBundleManifest(manifest)).toEqual([])
  })
})
