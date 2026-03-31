import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  adoptResultSchema,
  auditResultSchema,
  cliErrorSchema,
  createCLIOutputSchema,
  deprecateResultSchema,
  diffResultSchema,
  initResultSchema,
  installResultSchema,
  listResultSchema,
  loginResultSchema,
  logoutResultSchema,
  proposalsResultSchema,
  proposeResultSchema,
  removeResultSchema,
  scanResultSchema,
  searchResultSchema,
  statusResultSchema,
  syncResultSchema,
  unpublishResultSchema,
  updateResultSchema,
  whoamiResultSchema,
} from '../cli-output'

// ---------------------------------------------------------------------------
// cliErrorSchema
// ---------------------------------------------------------------------------

describe('cliErrorSchema', () => {
  it('should accept a valid error with code and message', () => {
    const result = cliErrorSchema.parse({ code: 'NOT_FOUND', message: 'Resource not found' })
    expect(result.code).toBe('NOT_FOUND')
    expect(result.message).toBe('Resource not found')
  })

  it('should reject missing code', () => {
    const result = cliErrorSchema.safeParse({ message: 'Something went wrong' })
    expect(result.success).toBe(false)
  })

  it('should reject missing message', () => {
    const result = cliErrorSchema.safeParse({ code: 'ERR' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createCLIOutputSchema
// ---------------------------------------------------------------------------

describe('createCLIOutputSchema', () => {
  const wrappedSchema = createCLIOutputSchema(z.object({ count: z.number() }))

  it('should accept a successful output with matching data', () => {
    const result = wrappedSchema.parse({
      success: true,
      data: { count: 42 },
    })
    expect(result.success).toBe(true)
    expect(result.data?.count).toBe(42)
  })

  it('should accept an error output without data', () => {
    const result = wrappedSchema.parse({
      success: false,
      error: { code: 'ERR', message: 'Failed' },
    })
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('ERR')
  })

  it('should accept output with warnings', () => {
    const result = wrappedSchema.parse({
      success: true,
      data: { count: 1 },
      warnings: ['Deprecated format'],
    })
    expect(result.warnings).toEqual(['Deprecated format'])
  })

  it('should make data optional', () => {
    const result = wrappedSchema.parse({ success: false })
    expect(result.data).toBeUndefined()
  })

  it('should make error optional', () => {
    const result = wrappedSchema.parse({ success: true, data: { count: 0 } })
    expect(result.error).toBeUndefined()
  })

  it('should reject data that does not match the inner schema', () => {
    const result = wrappedSchema.safeParse({
      success: true,
      data: { count: 'not-a-number' },
    })
    expect(result.success).toBe(false)
  })

  it('should reject missing success field', () => {
    const result = wrappedSchema.safeParse({ data: { count: 1 } })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Per-command result schemas — valid data acceptance
// ---------------------------------------------------------------------------

describe('loginResultSchema', () => {
  it('should accept valid login result', () => {
    const result = loginResultSchema.parse({
      token: 'abc123',
      user: { id: 'usr_1', email: 'test@example.com', name: 'Test User' },
    })
    expect(result.token).toBe('abc123')
    expect(result.user.email).toBe('test@example.com')
  })

  it('should reject missing user', () => {
    const result = loginResultSchema.safeParse({ token: 'abc123' })
    expect(result.success).toBe(false)
  })

  it('should accept missing token (optional for CLI)', () => {
    const result = loginResultSchema.safeParse({
      user: { id: '1', email: 'a@b.com', name: 'A' },
    })
    expect(result.success).toBe(true)
  })
})

describe('logoutResultSchema', () => {
  it('should accept valid logout result', () => {
    const result = logoutResultSchema.parse({ cleared: true })
    expect(result.cleared).toBe(true)
  })

  it('should reject missing cleared field', () => {
    const result = logoutResultSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('should reject non-boolean cleared', () => {
    const result = logoutResultSchema.safeParse({ cleared: 'yes' })
    expect(result.success).toBe(false)
  })
})

describe('whoamiResultSchema', () => {
  it('should accept unauthenticated result', () => {
    const result = whoamiResultSchema.parse({ authenticated: false })
    expect(result.authenticated).toBe(false)
    expect(result.user).toBeUndefined()
  })

  it('should accept authenticated result with user', () => {
    const result = whoamiResultSchema.parse({
      authenticated: true,
      user: { id: 'usr_1', email: 'test@example.com', name: 'Test' },
      platform: 'https://app.agentver.com',
    })
    expect(result.user?.email).toBe('test@example.com')
    expect(result.platform).toBe('https://app.agentver.com')
  })

  it('should accept optional organisation', () => {
    const result = whoamiResultSchema.parse({
      authenticated: true,
      organisation: 'acme-org',
    })
    expect(result.organisation).toBe('acme-org')
  })

  it('should reject missing authenticated field', () => {
    const result = whoamiResultSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('installResultSchema', () => {
  const validInstall = {
    name: 'my-skill',
    source: { type: 'git', uri: 'https://github.com/org/repo' },
    agents: ['claude'],
    path: '/path/to/skill',
    scope: 'project',
    audit: { passed: true, findings: 0, blockers: 0 },
  }

  it('should accept valid install result', () => {
    const result = installResultSchema.parse(validInstall)
    expect(result.name).toBe('my-skill')
    expect(result.audit.passed).toBe(true)
  })

  it('should reject missing audit', () => {
    const { audit: _, ...withoutAudit } = validInstall
    const result = installResultSchema.safeParse(withoutAudit)
    expect(result.success).toBe(false)
  })

  it('should reject missing source', () => {
    const { source: _, ...withoutSource } = validInstall
    const result = installResultSchema.safeParse(withoutSource)
    expect(result.success).toBe(false)
  })
})

describe('removeResultSchema', () => {
  it('should accept valid remove result', () => {
    const result = removeResultSchema.parse({
      name: 'my-skill',
      removed: true,
      paths: ['/path/to/skill'],
    })
    expect(result.removed).toBe(true)
  })

  it('should reject missing paths', () => {
    const result = removeResultSchema.safeParse({
      name: 'my-skill',
      removed: true,
    })
    expect(result.success).toBe(false)
  })
})

describe('updateResultSchema', () => {
  it('should accept valid update result with updated and skipped', () => {
    const result = updateResultSchema.parse({
      updated: [{ name: 'skill-a', fromRef: 'abc1234', toRef: 'def5678', strategy: 'archive' }],
      skipped: [{ name: 'skill-b', reason: 'locally modified' }],
    })
    expect(result.updated).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
  })

  it('should accept empty arrays', () => {
    const result = updateResultSchema.parse({ updated: [], skipped: [] })
    expect(result.updated).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
  })

  it('should reject missing skipped field', () => {
    const result = updateResultSchema.safeParse({
      updated: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('listResultSchema', () => {
  it('should accept empty packages record', () => {
    const result = listResultSchema.parse({ packages: [] })
    expect(result.packages).toEqual([])
  })

  it('should accept packages with valid manifest entries', () => {
    const result = listResultSchema.parse({
      packages: [
        {
          name: 'my-skill',
          scope: 'project',
          package: {
            source: {
              type: 'git',
              uri: 'https://github.com/org/repo',
              path: '',
              ref: 'main',
              commit: 'abc1234',
            },
            agents: ['claude'],
            installedAt: new Date().toISOString(),
          },
        },
      ],
    })
    expect(result.packages).toHaveLength(1)
  })

  it('should reject packages with invalid source', () => {
    const result = listResultSchema.safeParse({
      packages: [{ name: 'bad-skill', scope: 'project', package: { source: { type: 'invalid' } } }],
    })
    expect(result.success).toBe(false)
  })
})

describe('searchResultSchema', () => {
  it('should accept valid search results', () => {
    const result = searchResultSchema.parse({
      platform: [],
      community: [],
      wellKnown: [{ name: 'skill-a', description: 'A skill', url: 'https://example.com/skill-a' }],
      total: 1,
    })
    expect(result.wellKnown).toHaveLength(1)
  })

  it('should accept empty results', () => {
    const result = searchResultSchema.parse({
      platform: [],
      community: [],
      wellKnown: [],
      total: 0,
    })
    expect(result.platform).toHaveLength(0)
  })

  it('should accept results with optional url', () => {
    const result = searchResultSchema.parse({
      platform: [],
      community: [
        {
          id: 'community-1',
          name: 'skill-a',
          description: 'A skill',
          source: 'registry',
          installCount: 10,
          url: 'https://example.com',
        },
      ],
      wellKnown: [],
      total: 1,
    })
    expect(result.community[0]?.url).toBe('https://example.com')
  })
})

describe('auditResultSchema', () => {
  it('should accept passed audit with no findings', () => {
    const result = auditResultSchema.parse({
      target: '/path/to/skill',
      passed: true,
      findings: [],
    })
    expect(result.passed).toBe(true)
  })

  it('should accept failed audit with findings', () => {
    const result = auditResultSchema.parse({
      target: '/path/to/skill',
      passed: false,
      findings: [
        {
          rule: 'no-secrets',
          severity: 'critical',
          file: 'index.ts',
          line: 10,
          evidence: 'API_KEY=...',
        },
      ],
    })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.rule).toBe('no-secrets')
  })

  it('should reject finding with missing line number', () => {
    const result = auditResultSchema.safeParse({
      target: '/path',
      passed: false,
      findings: [{ rule: 'r', severity: 's', file: 'f', evidence: 'e' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('scanResultSchema', () => {
  it('should accept scan with agents and skills', () => {
    const result = scanResultSchema.parse({
      agents: [{ id: 'claude-code', name: 'Claude Code', paths: ['.claude/CLAUDE.md'] }],
      skills: [{ name: 'my-skill', path: '/path/to/SKILL.md', type: 'SKILL' }],
    })
    expect(result.agents).toHaveLength(1)
    expect(result.skills).toHaveLength(1)
  })

  it('should accept empty arrays', () => {
    const result = scanResultSchema.parse({ agents: [], skills: [] })
    expect(result.agents).toHaveLength(0)
    expect(result.skills).toHaveLength(0)
  })

  it('should reject agent missing id', () => {
    const result = scanResultSchema.safeParse({
      agents: [{ name: 'Claude', paths: [] }],
      skills: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('statusResultSchema', () => {
  it('should accept status with packages and summary', () => {
    const result = statusResultSchema.parse({
      packages: [{ name: 'my-skill', status: 'up-to-date', modified: false, upstream: false }],
      summary: { total: 1, upToDate: 1, modified: 0, upstream: 0, unknown: 0 },
    })
    expect(result.summary.total).toBe(1)
  })

  it('should accept empty packages with zero summary', () => {
    const result = statusResultSchema.parse({
      packages: [],
      summary: { total: 0, upToDate: 0, modified: 0, upstream: 0, unknown: 0 },
    })
    expect(result.packages).toHaveLength(0)
  })

  it('should reject summary with missing fields', () => {
    const result = statusResultSchema.safeParse({
      packages: [],
      summary: { total: 0 },
    })
    expect(result.success).toBe(false)
  })
})

describe('diffResultSchema', () => {
  it('should accept valid diff result', () => {
    const result = diffResultSchema.parse({
      name: 'my-skill',
      hunks: [{ file: 'SKILL.md', additions: 5, deletions: 2, content: '@@ -1,5 +1,8 @@' }],
    })
    expect(result.hunks).toHaveLength(1)
  })

  it('should accept empty hunks', () => {
    const result = diffResultSchema.parse({ name: 'my-skill', hunks: [] })
    expect(result.hunks).toHaveLength(0)
  })
})

describe('proposeResultSchema', () => {
  it('should accept valid proposal result', () => {
    const result = proposeResultSchema.parse({
      proposalId: 'prop_123',
      title: 'Fix typo in SKILL.md',
      url: 'https://app.agentver.com/proposals/prop_123',
    })
    expect(result.proposalId).toBe('prop_123')
  })

  it('should reject missing url', () => {
    const result = proposeResultSchema.safeParse({
      proposalId: 'prop_123',
      title: 'Fix typo',
    })
    expect(result.success).toBe(false)
  })
})

describe('proposalsResultSchema', () => {
  it('should accept valid proposals list', () => {
    const result = proposalsResultSchema.parse({
      proposals: [
        {
          id: 'prop_1',
          title: 'Add docs',
          status: 'open',
          author: 'testuser',
          packageName: 'my-skill',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    })
    expect(result.proposals).toHaveLength(1)
  })

  it('should accept empty proposals', () => {
    const result = proposalsResultSchema.parse({ proposals: [] })
    expect(result.proposals).toHaveLength(0)
  })
})

describe('syncResultSchema', () => {
  it('should accept valid sync result', () => {
    const result = syncResultSchema.parse({
      synced: 3,
      machineId: 'machine_abc',
      packages: ['skill-a', 'skill-b', 'skill-c'],
    })
    expect(result.synced).toBe(3)
    expect(result.packages).toHaveLength(3)
  })

  it('should reject missing machineId', () => {
    const result = syncResultSchema.safeParse({
      synced: 0,
      packages: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('initResultSchema', () => {
  it('should accept valid init result', () => {
    const result = initResultSchema.parse({
      name: 'my-skill',
      type: 'skill',
      path: '/home/user/my-skill',
      files: ['SKILL.md', 'examples/README.md'],
    })
    expect(result.files).toHaveLength(2)
  })

  it('should reject missing files array', () => {
    const result = initResultSchema.safeParse({
      name: 'my-skill',
      type: 'skill',
      path: '/home/user/my-skill',
    })
    expect(result.success).toBe(false)
  })

  it('should reject missing name', () => {
    const result = initResultSchema.safeParse({
      type: 'skill',
      path: '/path',
      files: [],
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// adoptResultSchema
// ---------------------------------------------------------------------------

describe('adoptResultSchema', () => {
  it('should accept valid adopt result with adopted skills', () => {
    const result = adoptResultSchema.parse({
      adopted: [
        {
          name: 'my-skill',
          path: '/home/user/.claude/skills/my-skill/SKILL.md',
          type: 'skill',
          agents: ['claude-code'],
        },
      ],
      skipped: [],
    })
    expect(result.adopted).toHaveLength(1)
    expect(result.adopted[0]!.name).toBe('my-skill')
    expect(result.adopted[0]!.agents).toEqual(['claude-code'])
  })

  it('should accept valid adopt result with skipped skills', () => {
    const result = adoptResultSchema.parse({
      adopted: [],
      skipped: [
        {
          name: 'existing-skill',
          path: '/home/user/.claude/skills/existing-skill/SKILL.md',
          reason: 'already tracked in manifest',
        },
      ],
    })
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.reason).toBe('already tracked in manifest')
  })

  it('should accept empty arrays', () => {
    const result = adoptResultSchema.parse({
      adopted: [],
      skipped: [],
    })
    expect(result.adopted).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
  })

  it('should reject missing adopted field', () => {
    const result = adoptResultSchema.safeParse({
      skipped: [],
    })
    expect(result.success).toBe(false)
  })

  it('should reject missing skipped field', () => {
    const result = adoptResultSchema.safeParse({
      adopted: [],
    })
    expect(result.success).toBe(false)
  })

  it('should reject adopted entry missing agents array', () => {
    const result = adoptResultSchema.safeParse({
      adopted: [{ name: 'skill', path: '/path', type: 'skill' }],
      skipped: [],
    })
    expect(result.success).toBe(false)
  })

  it('should reject skipped entry missing reason', () => {
    const result = adoptResultSchema.safeParse({
      adopted: [],
      skipped: [{ name: 'skill', path: '/path' }],
    })
    expect(result.success).toBe(false)
  })

  it('should accept multiple adopted and skipped entries', () => {
    const result = adoptResultSchema.parse({
      adopted: [
        { name: 'skill-a', path: '/path/a', type: 'skill', agents: ['claude-code'] },
        { name: 'skill-b', path: '/path/b', type: 'config', agents: ['cursor', 'copilot'] },
      ],
      skipped: [
        { name: 'skill-c', path: '/path/c', reason: 'already tracked' },
        { name: 'skill-d', path: '/path/d', reason: 'unreadable file' },
      ],
    })
    expect(result.adopted).toHaveLength(2)
    expect(result.skipped).toHaveLength(2)
  })
})

describe('deprecateResultSchema', () => {
  it('should accept package deprecation output', () => {
    const result = deprecateResultSchema.parse({
      skill: '@test-org/test-skill',
      target: 'package',
      status: 'DEPRECATED',
      message: 'Use @test-org/new-skill instead',
    })
    expect(result.target).toBe('package')
    expect(result.status).toBe('DEPRECATED')
  })

  it('should reject missing skill', () => {
    const result = deprecateResultSchema.safeParse({
      target: 'version',
      status: 'DEPRECATED',
    })
    expect(result.success).toBe(false)
  })
})

describe('unpublishResultSchema', () => {
  it('should accept valid unpublish output', () => {
    const result = unpublishResultSchema.parse({
      skill: '@test-org/test-skill',
      version: '1.2.3',
      status: 'YANKED',
    })
    expect(result.version).toBe('1.2.3')
    expect(result.status).toBe('YANKED')
  })

  it('should reject missing version', () => {
    const result = unpublishResultSchema.safeParse({
      skill: '@test-org/test-skill',
      status: 'YANKED',
    })
    expect(result.success).toBe(false)
  })
})
