import { describe, expect, it } from 'vitest'

import {
  agentConfigSchema,
  fileManifestEntrySchema,
  fileManifestSchema,
  gitSourceSchema,
  lockfileAnySchema,
  lockfileSchema,
  lockfileV2Schema,
  manifestAnySchema,
  manifestSchema,
  manifestV2Schema,
  PACKAGE_STRUCTURES,
  packageSourceSchema,
  packageStructureSchema,
  pluginManifestSchema,
  promptFrontmatterSchema,
  scriptManifestSchema,
  skillFrontmatterSchema,
  skillMetadataSchema,
  wellKnownSourceSchema,
} from '../schemas'

// ---------------------------------------------------------------------------
// Helpers — reusable valid objects
// ---------------------------------------------------------------------------

const validGitSource = {
  type: 'git' as const,
  uri: 'https://github.com/org/repo',
  path: 'skills/my-skill',
  ref: 'main',
  commit: 'abc1234',
}

const validWellKnownSource = {
  type: 'well-known' as const,
  baseUrl: 'https://example.com/.well-known/skills',
  hostname: 'example.com',
  skillName: 'my-skill',
}

const now = new Date().toISOString()

// ---------------------------------------------------------------------------
// skillMetadataSchema
// ---------------------------------------------------------------------------

describe('skillMetadataSchema', () => {
  it('should accept valid minimal metadata (name, version, type)', () => {
    const result = skillMetadataSchema.parse({
      name: 'my-skill',
      version: '1.0.0',
      type: 'SKILL',
    })
    expect(result.name).toBe('my-skill')
    expect(result.tags).toEqual([])
    expect(result.agents).toEqual([])
  })

  it('should accept valid metadata with all optional fields', () => {
    const result = skillMetadataSchema.parse({
      name: 'my-skill',
      description: 'A great skill',
      version: '2.3.1',
      type: 'PLUGIN',
      tags: ['testing', 'ai'],
      agents: ['claude-code', 'cursor'],
    })
    expect(result.description).toBe('A great skill')
    expect(result.tags).toEqual(['testing', 'ai'])
    expect(result.agents).toEqual(['claude-code', 'cursor'])
  })

  it('should reject empty name', () => {
    const result = skillMetadataSchema.safeParse({
      name: '',
      version: '1.0.0',
      type: 'SKILL',
    })
    expect(result.success).toBe(false)
  })

  it('should reject name exceeding 100 characters', () => {
    const result = skillMetadataSchema.safeParse({
      name: 'a'.repeat(101),
      version: '1.0.0',
      type: 'SKILL',
    })
    expect(result.success).toBe(false)
  })

  it('should accept name at boundary (1 char, 100 chars)', () => {
    skillMetadataSchema.parse({ name: 'a', version: '1.0.0', type: 'SKILL' })
    skillMetadataSchema.parse({ name: 'a'.repeat(100), version: '1.0.0', type: 'SKILL' })
  })

  it('should reject description exceeding 500 characters', () => {
    const result = skillMetadataSchema.safeParse({
      name: 'ok',
      description: 'x'.repeat(501),
      version: '1.0.0',
      type: 'SKILL',
    })
    expect(result.success).toBe(false)
  })

  it('should reject invalid semver version', () => {
    for (const bad of ['1.0', 'v1.0.0', 'abc', '1.0.0.0']) {
      const result = skillMetadataSchema.safeParse({ name: 'ok', version: bad, type: 'SKILL' })
      expect(result.success).toBe(false)
    }
  })

  it('should accept valid semver with prerelease (1.0.0-alpha)', () => {
    skillMetadataSchema.parse({ name: 'ok', version: '1.0.0-alpha', type: 'SKILL' })
    skillMetadataSchema.parse({ name: 'ok', version: '0.1.0-beta.1', type: 'SKILL' })
  })

  it('should reject invalid package type', () => {
    const result = skillMetadataSchema.safeParse({ name: 'ok', version: '1.0.0', type: 'UNKNOWN' })
    expect(result.success).toBe(false)
  })

  it('should accept all 6 package types', () => {
    for (const type of ['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT', 'BUNDLE'] as const) {
      skillMetadataSchema.parse({ name: 'ok', version: '1.0.0', type })
    }
  })

  it('should default tags to empty array', () => {
    const result = skillMetadataSchema.parse({ name: 'ok', version: '1.0.0', type: 'SKILL' })
    expect(result.tags).toEqual([])
  })

  it('should reject more than 20 tags', () => {
    const result = skillMetadataSchema.safeParse({
      name: 'ok',
      version: '1.0.0',
      type: 'SKILL',
      tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
    })
    expect(result.success).toBe(false)
  })

  it('should reject tags exceeding 50 characters', () => {
    const result = skillMetadataSchema.safeParse({
      name: 'ok',
      version: '1.0.0',
      type: 'SKILL',
      tags: ['a'.repeat(51)],
    })
    expect(result.success).toBe(false)
  })

  it('should default agents to empty array', () => {
    const result = skillMetadataSchema.parse({ name: 'ok', version: '1.0.0', type: 'SKILL' })
    expect(result.agents).toEqual([])
  })

  it('should accept valid agent IDs from AGENT_IDS_FOR_SCHEMA', () => {
    skillMetadataSchema.parse({
      name: 'ok',
      version: '1.0.0',
      type: 'SKILL',
      agents: ['claude-code', 'cursor', 'roo', 'windsurf'],
    })
  })

  it('should reject unknown agent IDs', () => {
    const result = skillMetadataSchema.safeParse({
      name: 'ok',
      version: '1.0.0',
      type: 'SKILL',
      agents: ['not-a-real-agent'],
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// manifestSchema (v1)
// ---------------------------------------------------------------------------

describe('manifestSchema (v1)', () => {
  it('should accept valid v1 manifest with packages', () => {
    manifestSchema.parse({
      version: 1,
      packages: {
        'my-skill': {
          name: 'my-skill',
          version: '1.0.0',
          agents: ['claude-code'],
          installedAt: now,
        },
      },
    })
  })

  it('should accept v1 manifest with empty packages', () => {
    manifestSchema.parse({ version: 1, packages: {} })
  })

  it('should reject manifest with wrong version (not 1)', () => {
    const result = manifestSchema.safeParse({ version: 2, packages: {} })
    expect(result.success).toBe(false)
  })

  it('should reject manifest with missing version', () => {
    const result = manifestSchema.safeParse({ packages: {} })
    expect(result.success).toBe(false)
  })

  it('should reject package with invalid installedAt datetime', () => {
    const result = manifestSchema.safeParse({
      version: 1,
      packages: {
        'my-skill': {
          name: 'my-skill',
          version: '1.0.0',
          installedAt: 'not-a-date',
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it('should default agents to empty array in v1 packages', () => {
    const result = manifestSchema.parse({
      version: 1,
      packages: {
        'my-skill': {
          name: 'my-skill',
          version: '1.0.0',
          installedAt: now,
        },
      },
    })
    expect(result.packages['my-skill']!.agents).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// lockfileSchema (v1)
// ---------------------------------------------------------------------------

describe('lockfileSchema (v1)', () => {
  it('should accept valid v1 lockfile with integrity hash', () => {
    lockfileSchema.parse({
      version: 1,
      packages: {
        'my-skill': {
          version: '1.0.0',
          resolved: 'https://example.com/skill.tar.gz',
          integrity: 'sha256-abc123',
          agents: ['cursor'],
        },
      },
    })
  })

  it('should reject integrity without sha256- prefix', () => {
    const result = lockfileSchema.safeParse({
      version: 1,
      packages: {
        'my-skill': {
          version: '1.0.0',
          resolved: 'https://example.com/skill.tar.gz',
          integrity: 'md5-abc123',
          agents: [],
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it('should reject resolved as non-URL string', () => {
    const result = lockfileSchema.safeParse({
      version: 1,
      packages: {
        'my-skill': {
          version: '1.0.0',
          resolved: 'not-a-url',
          integrity: 'sha256-abc123',
          agents: [],
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it('should accept lockfile with empty packages', () => {
    lockfileSchema.parse({ version: 1, packages: {} })
  })
})

// ---------------------------------------------------------------------------
// gitSourceSchema
// ---------------------------------------------------------------------------

describe('gitSourceSchema', () => {
  it('should accept valid git source with all fields', () => {
    const result = gitSourceSchema.parse(validGitSource)
    expect(result.type).toBe('git')
    expect(result.uri).toBe('https://github.com/org/repo')
  })

  it('should reject empty uri', () => {
    const result = gitSourceSchema.safeParse({ ...validGitSource, uri: '' })
    expect(result.success).toBe(false)
  })

  it('should reject empty ref', () => {
    const result = gitSourceSchema.safeParse({ ...validGitSource, ref: '' })
    expect(result.success).toBe(false)
  })

  it('should reject commit shorter than 7 characters', () => {
    const result = gitSourceSchema.safeParse({ ...validGitSource, commit: 'abc12' })
    expect(result.success).toBe(false)
  })

  it('should accept commit at exactly 7 characters', () => {
    gitSourceSchema.parse({ ...validGitSource, commit: 'abc1234' })
  })

  it('should set type to literal "git"', () => {
    const result = gitSourceSchema.safeParse({ ...validGitSource, type: 'well-known' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// wellKnownSourceSchema
// ---------------------------------------------------------------------------

describe('wellKnownSourceSchema', () => {
  it('should accept valid well-known source', () => {
    const result = wellKnownSourceSchema.parse(validWellKnownSource)
    expect(result.type).toBe('well-known')
  })

  it('should reject empty baseUrl', () => {
    const result = wellKnownSourceSchema.safeParse({ ...validWellKnownSource, baseUrl: '' })
    expect(result.success).toBe(false)
  })

  it('should reject empty hostname', () => {
    const result = wellKnownSourceSchema.safeParse({ ...validWellKnownSource, hostname: '' })
    expect(result.success).toBe(false)
  })

  it('should reject empty skillName', () => {
    const result = wellKnownSourceSchema.safeParse({ ...validWellKnownSource, skillName: '' })
    expect(result.success).toBe(false)
  })

  it('should set type to literal "well-known"', () => {
    const result = wellKnownSourceSchema.safeParse({ ...validWellKnownSource, type: 'git' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// packageSourceSchema (discriminated union)
// ---------------------------------------------------------------------------

describe('packageSourceSchema (discriminated union)', () => {
  it('should accept valid git source', () => {
    const result = packageSourceSchema.parse(validGitSource)
    expect(result.type).toBe('git')
  })

  it('should accept valid well-known source', () => {
    const result = packageSourceSchema.parse(validWellKnownSource)
    expect(result.type).toBe('well-known')
  })

  it('should reject source with unknown type', () => {
    const result = packageSourceSchema.safeParse({ type: 'npm', url: 'https://example.com' })
    expect(result.success).toBe(false)
  })

  it('should reject source with missing type field', () => {
    const result = packageSourceSchema.safeParse({ uri: 'https://github.com/org/repo' })
    expect(result.success).toBe(false)
  })

  it('should reject git source with well-known fields only', () => {
    const result = packageSourceSchema.safeParse({
      type: 'git',
      baseUrl: 'https://example.com',
      hostname: 'example.com',
      skillName: 'my-skill',
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// manifestV2Schema
// ---------------------------------------------------------------------------

describe('manifestV2Schema', () => {
  const validV2Package = {
    source: validGitSource,
    agents: ['claude-code'],
    installedAt: now,
  }

  it('should accept valid v2 manifest', () => {
    manifestV2Schema.parse({
      version: 2,
      packages: { 'my-skill': validV2Package },
    })
  })

  it('should reject manifest with version not 2', () => {
    const result = manifestV2Schema.safeParse({
      version: 1,
      packages: { 'my-skill': validV2Package },
    })
    expect(result.success).toBe(false)
  })

  it('should accept v2 manifest with git source packages', () => {
    manifestV2Schema.parse({
      version: 2,
      packages: {
        'git-skill': { source: validGitSource, agents: [], installedAt: now },
      },
    })
  })

  it('should accept v2 manifest with well-known source packages', () => {
    manifestV2Schema.parse({
      version: 2,
      packages: {
        'wk-skill': { source: validWellKnownSource, agents: [], installedAt: now },
      },
    })
  })

  it('should default modified to false', () => {
    const result = manifestV2Schema.parse({
      version: 2,
      packages: {
        'my-skill': { source: validGitSource, agents: [], installedAt: now },
      },
    })
    expect(result.packages['my-skill']!.modified).toBe(false)
  })

  it('should accept modified: true', () => {
    const result = manifestV2Schema.parse({
      version: 2,
      packages: {
        'my-skill': { source: validGitSource, agents: [], installedAt: now, modified: true },
      },
    })
    expect(result.packages['my-skill']!.modified).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// lockfileV2Schema
// ---------------------------------------------------------------------------

describe('lockfileV2Schema', () => {
  const validV2LockPkg = {
    source: validGitSource,
    integrity: 'sha256-deadbeef',
    agents: ['cursor'],
  }

  it('should accept valid v2 lockfile', () => {
    lockfileV2Schema.parse({
      version: 2,
      packages: { 'my-skill': validV2LockPkg },
    })
  })

  it('should reject lockfile with version not 2', () => {
    const result = lockfileV2Schema.safeParse({
      version: 1,
      packages: { 'my-skill': validV2LockPkg },
    })
    expect(result.success).toBe(false)
  })

  it('should reject integrity without sha256- prefix', () => {
    const result = lockfileV2Schema.safeParse({
      version: 2,
      packages: {
        'my-skill': { ...validV2LockPkg, integrity: 'md5-bad' },
      },
    })
    expect(result.success).toBe(false)
  })

  it('should accept lockfile with git and well-known sources', () => {
    lockfileV2Schema.parse({
      version: 2,
      packages: {
        'git-skill': validV2LockPkg,
        'wk-skill': {
          source: validWellKnownSource,
          integrity: 'sha256-cafebabe',
          agents: [],
        },
      },
    })
  })
})

// ---------------------------------------------------------------------------
// manifestAnySchema (discriminated union)
// ---------------------------------------------------------------------------

describe('manifestAnySchema (discriminated union)', () => {
  it('should accept valid v1 manifest', () => {
    const result = manifestAnySchema.parse({ version: 1, packages: {} })
    expect(result.version).toBe(1)
  })

  it('should accept valid v2 manifest', () => {
    const result = manifestAnySchema.parse({ version: 2, packages: {} })
    expect(result.version).toBe(2)
  })

  it('should reject manifest without version', () => {
    const result = manifestAnySchema.safeParse({ packages: {} })
    expect(result.success).toBe(false)
  })

  it('should reject manifest with unsupported version (3)', () => {
    const result = manifestAnySchema.safeParse({ version: 3, packages: {} })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// lockfileAnySchema (discriminated union)
// ---------------------------------------------------------------------------

describe('lockfileAnySchema (discriminated union)', () => {
  it('should accept valid v1 lockfile', () => {
    const result = lockfileAnySchema.parse({ version: 1, packages: {} })
    expect(result.version).toBe(1)
  })

  it('should accept valid v2 lockfile', () => {
    const result = lockfileAnySchema.parse({ version: 2, packages: {} })
    expect(result.version).toBe(2)
  })

  it('should reject lockfile without version', () => {
    const result = lockfileAnySchema.safeParse({ packages: {} })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// packageStructureSchema
// ---------------------------------------------------------------------------

describe('packageStructureSchema', () => {
  it('should accept valid package structure for each type', () => {
    for (const type of ['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT'] as const) {
      packageStructureSchema.parse({ type, entryFile: 'entry.md' })
    }
  })

  it('should reject unknown package type', () => {
    const result = packageStructureSchema.safeParse({ type: 'UNKNOWN', entryFile: 'x.md' })
    expect(result.success).toBe(false)
  })

  it('should default requiredFiles to empty array', () => {
    const result = packageStructureSchema.parse({ type: 'SKILL', entryFile: 'SKILL.md' })
    expect(result.requiredFiles).toEqual([])
  })

  it('should default optionalDirs to empty array', () => {
    const result = packageStructureSchema.parse({ type: 'SKILL', entryFile: 'SKILL.md' })
    expect(result.optionalDirs).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// PACKAGE_STRUCTURES constant
// ---------------------------------------------------------------------------

describe('PACKAGE_STRUCTURES constant', () => {
  it('should have structure for all 6 package types', () => {
    expect(Object.keys(PACKAGE_STRUCTURES)).toEqual(
      expect.arrayContaining(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT', 'BUNDLE'])
    )
    expect(Object.keys(PACKAGE_STRUCTURES)).toHaveLength(6)
  })

  it('should set SKILL entryFile to SKILL.md', () => {
    expect(PACKAGE_STRUCTURES.SKILL!.entryFile).toBe('SKILL.md')
  })

  it('should set AGENT_CONFIG entryFile to CLAUDE.md', () => {
    expect(PACKAGE_STRUCTURES.AGENT_CONFIG!.entryFile).toBe('CLAUDE.md')
  })

  it('should set PLUGIN entryFile to plugin.json', () => {
    expect(PACKAGE_STRUCTURES.PLUGIN!.entryFile).toBe('plugin.json')
  })

  it('should set SCRIPT entryFile to script.json', () => {
    expect(PACKAGE_STRUCTURES.SCRIPT!.entryFile).toBe('script.json')
  })

  it('should set PROMPT entryFile to PROMPT.md', () => {
    expect(PACKAGE_STRUCTURES.PROMPT!.entryFile).toBe('PROMPT.md')
  })
})

// ---------------------------------------------------------------------------
// skillFrontmatterSchema
// ---------------------------------------------------------------------------

describe('skillFrontmatterSchema', () => {
  it('should accept minimal frontmatter (name + description)', () => {
    skillFrontmatterSchema.parse({ name: 'my-skill', description: 'Does things' })
  })

  it('should accept full frontmatter with all optional fields', () => {
    skillFrontmatterSchema.parse({
      name: 'my-skill',
      description: 'Does things',
      version: '1.2.3',
      license: 'MIT',
      compatibility: ['claude-code', 'cursor'],
      metadata: { author: 'testuser' },
      'allowed-tools': ['Read', 'Write'],
    })
  })

  it('should reject empty name', () => {
    const result = skillFrontmatterSchema.safeParse({ name: '', description: 'ok' })
    expect(result.success).toBe(false)
  })

  it('should reject empty description', () => {
    const result = skillFrontmatterSchema.safeParse({ name: 'ok', description: '' })
    expect(result.success).toBe(false)
  })

  it('should accept optional version as valid semver', () => {
    skillFrontmatterSchema.parse({ name: 'ok', description: 'ok', version: '0.0.1-rc.1' })
  })

  it('should accept compatibility as string and transform to array', () => {
    const result = skillFrontmatterSchema.parse({
      name: 'ok',
      description: 'ok',
      compatibility: 'claude-code, cursor',
    })
    expect(result.compatibility).toEqual(['claude-code', 'cursor'])
  })

  it('should accept compatibility as array unchanged', () => {
    const result = skillFrontmatterSchema.parse({
      name: 'ok',
      description: 'ok',
      compatibility: ['claude-code', 'cursor'],
    })
    expect(result.compatibility).toEqual(['claude-code', 'cursor'])
  })

  it('should accept allowed-tools as array of strings', () => {
    const result = skillFrontmatterSchema.parse({
      name: 'ok',
      description: 'ok',
      'allowed-tools': ['Bash', 'Read'],
    })
    expect(result['allowed-tools']).toEqual(['Bash', 'Read'])
  })

  it('should accept allowed-tools as string and transform to array', () => {
    const result = skillFrontmatterSchema.parse({
      name: 'ok',
      description: 'ok',
      'allowed-tools': 'Read Write Bash',
    })
    expect(result['allowed-tools']).toEqual(['Read', 'Write', 'Bash'])
  })

  it('should leave compatibility and allowed-tools as undefined when omitted', () => {
    const result = skillFrontmatterSchema.parse({
      name: 'ok',
      description: 'ok',
    })
    expect(result.compatibility).toBeUndefined()
    expect(result['allowed-tools']).toBeUndefined()
  })

  it('should accept metadata as record of strings', () => {
    const result = skillFrontmatterSchema.parse({
      name: 'ok',
      description: 'ok',
      metadata: { author: 'testuser', org: 'acme-org' },
    })
    expect(result.metadata).toEqual({ author: 'testuser', org: 'acme-org' })
  })
})

// ---------------------------------------------------------------------------
// pluginManifestSchema
// ---------------------------------------------------------------------------

describe('pluginManifestSchema', () => {
  it('should accept minimal plugin manifest (name only)', () => {
    pluginManifestSchema.parse({ name: 'my-plugin' })
  })

  it('should accept manifest with tools array', () => {
    pluginManifestSchema.parse({
      name: 'my-plugin',
      tools: [{ name: 'lint', description: 'Runs linter', command: 'bun lint' }, { name: 'test' }],
    })
  })

  it('should accept manifest with MCP config (serverCommand required)', () => {
    pluginManifestSchema.parse({
      name: 'my-plugin',
      mcp: { serverCommand: 'node server.js', args: ['--port', '3000'] },
    })
  })

  it('should reject MCP config without serverCommand', () => {
    const result = pluginManifestSchema.safeParse({
      name: 'my-plugin',
      mcp: { args: ['--port', '3000'] },
    })
    expect(result.success).toBe(false)
  })

  it('should accept hooks as record of strings', () => {
    pluginManifestSchema.parse({
      name: 'my-plugin',
      hooks: { 'pre-install': 'echo hello', 'post-install': 'echo done' },
    })
  })

  it('should accept rules as array of strings', () => {
    pluginManifestSchema.parse({
      name: 'my-plugin',
      rules: ['Always use TypeScript', 'Never use any'],
    })
  })
})

// ---------------------------------------------------------------------------
// scriptManifestSchema
// ---------------------------------------------------------------------------

describe('scriptManifestSchema', () => {
  it('should accept valid script manifest for each runtime', () => {
    for (const runtime of ['node', 'bun', 'python', 'bash'] as const) {
      scriptManifestSchema.parse({ name: 'my-script', runtime, entryPoint: 'index.ts' })
    }
  })

  it('should reject unknown runtime', () => {
    const result = scriptManifestSchema.safeParse({
      name: 'my-script',
      runtime: 'deno',
      entryPoint: 'main.ts',
    })
    expect(result.success).toBe(false)
  })

  it('should reject missing entryPoint', () => {
    const result = scriptManifestSchema.safeParse({ name: 'my-script', runtime: 'node' })
    expect(result.success).toBe(false)
  })

  it('should accept all 4 runtimes (node, bun, python, bash)', () => {
    const runtimes = ['node', 'bun', 'python', 'bash'] as const
    for (const runtime of runtimes) {
      const result = scriptManifestSchema.parse({ name: 's', runtime, entryPoint: 'x' })
      expect(result.runtime).toBe(runtime)
    }
  })
})

// ---------------------------------------------------------------------------
// promptFrontmatterSchema
// ---------------------------------------------------------------------------

describe('promptFrontmatterSchema', () => {
  it('should accept minimal prompt (name + description)', () => {
    promptFrontmatterSchema.parse({ name: 'my-prompt', description: 'Generates code' })
  })

  it('should accept prompt with variables array', () => {
    promptFrontmatterSchema.parse({
      name: 'my-prompt',
      description: 'Generates code',
      variables: [{ name: 'language', description: 'Target language' }, { name: 'framework' }],
    })
  })

  it('should accept variable with optional fields (required, default)', () => {
    const result = promptFrontmatterSchema.parse({
      name: 'my-prompt',
      description: 'Generates code',
      variables: [
        { name: 'language', description: 'Target language', required: true, default: 'typescript' },
      ],
    })
    expect(result.variables?.[0]?.required).toBe(true)
    expect(result.variables?.[0]?.default).toBe('typescript')
  })
})

// ---------------------------------------------------------------------------
// agentConfigSchema
// ---------------------------------------------------------------------------

describe('agentConfigSchema', () => {
  it('should accept valid config with targetAgents', () => {
    agentConfigSchema.parse({
      name: 'my-config',
      description: 'Config for Claude',
      targetAgents: ['claude-code'],
    })
  })

  it('should reject empty targetAgents array', () => {
    const result = agentConfigSchema.safeParse({
      name: 'my-config',
      description: 'Config',
      targetAgents: [],
    })
    expect(result.success).toBe(false)
  })

  it('should default composable to false', () => {
    const result = agentConfigSchema.parse({
      name: 'my-config',
      description: 'Config',
      targetAgents: ['cursor'],
    })
    expect(result.composable).toBe(false)
  })

  it('should accept optional baseConfig and sections', () => {
    agentConfigSchema.parse({
      name: 'my-config',
      description: 'Config',
      targetAgents: ['roo'],
      baseConfig: 'base.md',
      sections: ['testing', 'debugging'],
    })
  })
})

// ---------------------------------------------------------------------------
// fileManifestEntrySchema
// ---------------------------------------------------------------------------

describe('fileManifestEntrySchema', () => {
  it('should accept valid entry with all fields', () => {
    const result = fileManifestEntrySchema.parse({
      path: 'SKILL.md',
      size: 1024,
      hash: 'sha256-abc123',
      contentType: 'text/markdown',
    })
    expect(result.contentType).toBe('text/markdown')
  })

  it('should reject negative size', () => {
    const result = fileManifestEntrySchema.safeParse({
      path: 'SKILL.md',
      size: -1,
      hash: 'sha256-abc123',
    })
    expect(result.success).toBe(false)
  })

  it('should default contentType to text/plain', () => {
    const result = fileManifestEntrySchema.parse({
      path: 'SKILL.md',
      size: 512,
      hash: 'sha256-abc123',
    })
    expect(result.contentType).toBe('text/plain')
  })
})

// ---------------------------------------------------------------------------
// fileManifestSchema
// ---------------------------------------------------------------------------

describe('fileManifestSchema', () => {
  it('should accept valid manifest with files', () => {
    fileManifestSchema.parse({
      files: [{ path: 'SKILL.md', size: 100, hash: 'sha256-abc', contentType: 'text/markdown' }],
      totalSize: 100,
      entryFile: 'SKILL.md',
      packageType: 'SKILL',
    })
  })

  it('should reject negative totalSize', () => {
    const result = fileManifestSchema.safeParse({
      files: [],
      totalSize: -1,
      entryFile: 'SKILL.md',
      packageType: 'SKILL',
    })
    expect(result.success).toBe(false)
  })

  it('should reject unknown packageType', () => {
    const result = fileManifestSchema.safeParse({
      files: [],
      totalSize: 0,
      entryFile: 'SKILL.md',
      packageType: 'UNKNOWN',
    })
    expect(result.success).toBe(false)
  })
})
