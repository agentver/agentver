import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn(),
}))

import * as fs from 'node:fs'
import {
  detectSkillName,
  extractOrgFromSourceUri,
  resolveCurrentSkillIdentity,
  resolveNamespace,
} from '../../commands/skill-context'
import { readManifest } from '../../storage/manifest.js'

describe('commands/skill-context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readManifest).mockReturnValue({ version: 2, packages: {} })
  })

  it('detects the skill name from SKILL.md frontmatter', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('name: search-console\n')

    expect(detectSkillName('/tmp/skills/acme-corp/search-console')).toBe('search-console')
  })

  it('returns null when SKILL.md is absent', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(detectSkillName('/tmp/skills/acme-corp/search-console')).toBeNull()
  })

  it('extracts the org from agentver URIs with and without refs', () => {
    expect(extractOrgFromSourceUri('agentver://acme-corp/skills/gsc@main')).toBe('acme-corp')
    expect(extractOrgFromSourceUri('agentver://acme-corp/skills/gsc')).toBe('acme-corp')
  })

  it('extracts the owner from GitHub HTTPS URIs', () => {
    expect(extractOrgFromSourceUri('https://github.com/acme-corp/agentver')).toBe('acme-corp')
  })

  it('falls back to the only path segment for short source URIs', () => {
    expect(extractOrgFromSourceUri('acme-corp')).toBe('acme-corp')
  })

  it('resolves the org from the skill path when manifest lookup misses', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(
      resolveNamespace({
        projectRoot: '/project',
        skillDir: '/tmp/skills/acme-corp/search-console',
        skillName: 'search-console',
      })
    ).toEqual({
      org: 'acme-corp',
      name: 'search-console',
    })
  })

  it('resolves the current skill identity from cwd fallback', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(
      resolveCurrentSkillIdentity({
        projectRoot: '/project',
        cwd: '/tmp/skills/acme-corp/search-console',
      })
    ).toEqual({
      org: 'acme-corp',
      name: 'search-console',
    })
  })
})
