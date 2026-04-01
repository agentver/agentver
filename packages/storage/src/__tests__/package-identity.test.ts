import { STORAGE_SCHEMA_VERSION } from '@agentver/shared'
import { describe, expect, it } from 'vitest'
import type {
  GitSource,
  LocalSource,
  LockfileV2,
  ManifestV2,
  PlatformSource,
  UnknownSource,
  WellKnownSource,
} from '../index'
import {
  createStablePackageKey,
  getDisplayName,
  resolvePackageQuery,
  setLockfilePackage,
  setManifestPackage,
} from '../index'

// --- Fixtures ---

const gitSource: GitSource = {
  type: 'git',
  uri: 'https://github.com/org/repo.git',
  path: 'skills/my-skill',
  ref: 'main',
  commit: 'abc1234',
}

const platformSource: PlatformSource = {
  type: 'platform',
  uri: 'agentver://org/repo',
  path: 'skills/platform-skill',
  ref: 'main',
  commit: 'def5678',
}

const wellKnownSource: WellKnownSource = {
  type: 'well-known',
  baseUrl: 'https://example.com/.well-known/agentver.json',
  hostname: 'example.com',
  skillName: 'my-wk-skill',
}

const localSource: LocalSource = {
  type: 'local',
  path: '/home/user/skills/local-skill',
}

const unknownSource: UnknownSource = {
  type: 'unknown',
  path: 'some/path',
  ref: 'v1',
  commit: 'aaaa',
}

// --- Tests ---

describe('createStablePackageKey', () => {
  it('creates correct key for git source', () => {
    const key = createStablePackageKey('my-skill', gitSource)
    expect(key).toBe(
      `git:${encodeURIComponent('https://github.com/org/repo.git#skills/my-skill#main')}`
    )
    expect(key.startsWith('git:')).toBe(true)
  })

  it('creates correct key for platform source', () => {
    const key = createStablePackageKey('platform-skill', platformSource)
    expect(key).toBe(
      `platform:${encodeURIComponent('agentver://org/repo#skills/platform-skill#main')}`
    )
  })

  it('creates correct key for well-known source', () => {
    const key = createStablePackageKey('my-wk-skill', wellKnownSource)
    expect(key).toBe(
      `well-known:${encodeURIComponent('https://example.com/.well-known/agentver.json#my-wk-skill')}`
    )
  })

  it('creates correct key for local source', () => {
    const key = createStablePackageKey('local-skill', localSource)
    expect(key).toBe(`local:${encodeURIComponent('/home/user/skills/local-skill')}`)
  })

  it('creates correct key for unknown source', () => {
    const key = createStablePackageKey('mystery', unknownSource)
    expect(key).toBe(`unknown:${encodeURIComponent('some/path#v1#aaaa#mystery')}`)
  })

  it('URI-encodes the identity portion', () => {
    const source: GitSource = {
      ...gitSource,
      uri: 'https://github.com/org/repo with spaces.git',
    }
    const key = createStablePackageKey('test', source)
    expect(key).toContain(encodeURIComponent('https://github.com/org/repo with spaces.git'))
    // The raw URI should NOT appear unencoded
    expect(key).not.toContain('repo with spaces')
  })
})

describe('resolvePackageQuery', () => {
  const packages: Record<string, { name?: string }> = {
    'git:key-alpha': { name: 'org/alpha' },
    'git:key-beta': { name: 'org/beta' },
    'local:key-gamma': { name: 'gamma' },
  }

  it('matches by exact key', () => {
    const result = resolvePackageQuery(packages, 'git:key-alpha')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.key).toBe('git:key-alpha')
      expect(result.displayName).toBe('org/alpha')
    }
  })

  it('matches by exact display name', () => {
    const result = resolvePackageQuery(packages, 'org/alpha')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.key).toBe('git:key-alpha')
    }
  })

  it('matches by short name (last path segment)', () => {
    const result = resolvePackageQuery(packages, 'alpha')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.key).toBe('git:key-alpha')
      expect(result.displayName).toBe('org/alpha')
    }
  })

  it('returns ambiguous failure when multiple short names match', () => {
    const ambiguousPackages: Record<string, { name?: string }> = {
      'git:key-a': { name: 'org-a/skill' },
      'git:key-b': { name: 'org-b/skill' },
    }
    const result = resolvePackageQuery(ambiguousPackages, 'skill')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('ambiguous')
      expect(result.matches).toHaveLength(2)
    }
  })

  it('returns ambiguous failure when multiple exact names match', () => {
    const dupes: Record<string, { name?: string }> = {
      'git:key-a': { name: 'duplicate' },
      'git:key-b': { name: 'duplicate' },
    }
    const result = resolvePackageQuery(dupes, 'duplicate')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('ambiguous')
      expect(result.matches).toHaveLength(2)
    }
  })

  it('returns not-found failure when no match exists', () => {
    const result = resolvePackageQuery(packages, 'nonexistent')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('not-found')
      expect(result.matches).toEqual([])
    }
  })
})

describe('setManifestPackage', () => {
  it('creates entry with stable key and returns the computed key', () => {
    const manifest: ManifestV2 = { version: STORAGE_SCHEMA_VERSION, packages: {} }
    const entry = {
      source: gitSource,
      agents: ['claude-code'],
      installedAt: new Date().toISOString(),
      modified: false,
    }

    const key = setManifestPackage(manifest, 'my-skill', entry)

    expect(key).toBe(createStablePackageKey('my-skill', gitSource))
    expect(manifest.packages[key]).toBeDefined()
    expect(manifest.packages[key]!.name).toBe('my-skill')
  })
})

describe('setLockfilePackage', () => {
  it('creates entry with stable key and returns the computed key', () => {
    const lockfile: LockfileV2 = { version: STORAGE_SCHEMA_VERSION, packages: {} }
    const entry = {
      source: gitSource,
      integrity: 'sha256-abc123',
      agents: ['claude-code'],
    }

    const key = setLockfilePackage(lockfile, 'my-skill', entry)

    expect(key).toBe(createStablePackageKey('my-skill', gitSource))
    expect(lockfile.packages[key]).toBeDefined()
    expect(lockfile.packages[key]!.name).toBe('my-skill')
  })
})

describe('getDisplayName', () => {
  it('returns pkg.name when present', () => {
    expect(getDisplayName('some-key', { name: 'My Skill' })).toBe('My Skill')
  })

  it('trims whitespace from pkg.name', () => {
    expect(getDisplayName('some-key', { name: '  My Skill  ' })).toBe('My Skill')
  })

  it('falls back to manifest key when name is absent', () => {
    expect(getDisplayName('fallback-key', {})).toBe('fallback-key')
  })

  it('falls back to manifest key when name is empty string', () => {
    expect(getDisplayName('fallback-key', { name: '' })).toBe('fallback-key')
  })

  it('falls back to manifest key when name is only whitespace', () => {
    expect(getDisplayName('fallback-key', { name: '   ' })).toBe('fallback-key')
  })
})
