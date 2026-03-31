import { basename } from 'node:path'
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

    expect(detectSkillName('/tmp/skills/lleverage/search-console')).toBe('search-console')
  })

  it('extracts the org from agentver URIs with and without refs', () => {
    expect(extractOrgFromSourceUri('agentver://lleverage/skills/gsc@main')).toBe('lleverage')
    expect(extractOrgFromSourceUri('agentver://lleverage/skills/gsc')).toBe('lleverage')
  })

  it('extracts the owner from GitHub HTTPS URIs', () => {
    expect(extractOrgFromSourceUri('https://github.com/lleverage/agentver')).toBe('lleverage')
  })

  it('falls back to the only path segment for short source URIs', () => {
    expect(extractOrgFromSourceUri('lleverage')).toBe('lleverage')
  })

  it('resolves the org from the skill path when manifest lookup misses', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(
      resolveNamespace({
        projectRoot: '/project',
        skillDir: '/tmp/skills/lleverage/search-console',
        skillName: 'search-console',
      })
    ).toEqual({
      org: 'lleverage',
      name: 'search-console',
    })
  })

  it('resolves the current skill identity from cwd fallback', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(
      resolveCurrentSkillIdentity({
        projectRoot: '/project',
        cwd: '/tmp/skills/lleverage/search-console',
      })
    ).toEqual({
      org: 'lleverage',
      name: basename('/tmp/skills/lleverage/search-console'),
    })
  })
})
