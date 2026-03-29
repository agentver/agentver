import { AgentverError } from '@agentver/shared'
import { describe, expect, it } from 'vitest'
import {
  enforceConflicts,
  enforceDependencies,
  extractDependencyMetadata,
  findReverseDependencies,
} from '../dependency-check'
import { createManifest, createManifestPackage } from './helpers/fixtures'

// ---------------------------------------------------------------------------
// extractDependencyMetadata
// ---------------------------------------------------------------------------

describe('extractDependencyMetadata', () => {
  it('returns empty arrays when no SKILL.md is present', () => {
    const files = [{ path: 'README.md', content: '# Hello', size: 7 }]
    const result = extractDependencyMetadata(files)
    expect(result).toEqual({ dependsOn: [], conflictsWith: [] })
  })

  it('returns empty arrays when SKILL.md has no dependency fields', () => {
    const content = [
      '---',
      'name: my-skill',
      'description: A test skill',
      '---',
      '',
      '# My Skill',
    ].join('\n')
    const files = [{ path: 'SKILL.md', content, size: content.length }]
    const result = extractDependencyMetadata(files)
    expect(result).toEqual({ dependsOn: [], conflictsWith: [] })
  })

  it('extracts dependsOn from SKILL.md frontmatter', () => {
    const content = [
      '---',
      'name: my-skill',
      'description: A test skill',
      'dependsOn:',
      '  - base-skill',
      '  - utils-skill',
      '---',
      '',
      '# My Skill',
    ].join('\n')
    const files = [{ path: 'SKILL.md', content, size: content.length }]
    const result = extractDependencyMetadata(files)
    expect(result.dependsOn).toEqual(['base-skill', 'utils-skill'])
    expect(result.conflictsWith).toEqual([])
  })

  it('extracts conflictsWith from SKILL.md frontmatter', () => {
    const content = [
      '---',
      'name: my-skill',
      'description: A test skill',
      'conflictsWith:',
      '  - rival-skill',
      '---',
      '',
      '# My Skill',
    ].join('\n')
    const files = [{ path: 'SKILL.md', content, size: content.length }]
    const result = extractDependencyMetadata(files)
    expect(result.dependsOn).toEqual([])
    expect(result.conflictsWith).toEqual(['rival-skill'])
  })

  it('extracts both dependsOn and conflictsWith', () => {
    const content = [
      '---',
      'name: my-skill',
      'description: A test skill',
      'dependsOn:',
      '  - dep-a',
      'conflictsWith:',
      '  - conflict-b',
      '---',
      '',
      '# My Skill',
    ].join('\n')
    const files = [{ path: 'SKILL.md', content, size: content.length }]
    const result = extractDependencyMetadata(files)
    expect(result.dependsOn).toEqual(['dep-a'])
    expect(result.conflictsWith).toEqual(['conflict-b'])
  })

  it('returns empty arrays when SKILL.md has invalid frontmatter', () => {
    const content = ['---', 'invalid: yaml: content: [broken', '---', '', '# My Skill'].join('\n')
    const files = [{ path: 'SKILL.md', content, size: content.length }]
    const result = extractDependencyMetadata(files)
    expect(result).toEqual({ dependsOn: [], conflictsWith: [] })
  })
})

// ---------------------------------------------------------------------------
// enforceDependencies
// ---------------------------------------------------------------------------

describe('enforceDependencies', () => {
  it('does nothing when dependsOn is empty', () => {
    const manifest = createManifest()
    expect(() => enforceDependencies([], manifest, 'my-skill')).not.toThrow()
  })

  it('does nothing when all dependencies are installed', () => {
    const manifest = createManifest({
      packages: {
        'base-skill': createManifestPackage(),
        'utils-skill': createManifestPackage(),
      },
    })
    expect(() =>
      enforceDependencies(['base-skill', 'utils-skill'], manifest, 'my-skill')
    ).not.toThrow()
  })

  it('throws DEPENDENCY_MISSING when a dependency is not installed', () => {
    const manifest = createManifest({
      packages: {
        'base-skill': createManifestPackage(),
      },
    })

    expect(() =>
      enforceDependencies(['base-skill', 'missing-skill'], manifest, 'my-skill')
    ).toThrow(AgentverError)

    try {
      enforceDependencies(['base-skill', 'missing-skill'], manifest, 'my-skill')
    } catch (error) {
      const agentverErr = error as AgentverError
      expect(agentverErr.code).toBe('DEPENDENCY_MISSING')
      expect(agentverErr.message).toContain('missing-skill')
      expect(agentverErr.message).toContain('my-skill')
      expect(agentverErr.message).not.toContain('base-skill')
    }
  })

  it('lists all missing dependencies in the error message', () => {
    const manifest = createManifest()

    try {
      enforceDependencies(['dep-a', 'dep-b'], manifest, 'my-skill')
    } catch (error) {
      const agentverErr = error as AgentverError
      expect(agentverErr.code).toBe('DEPENDENCY_MISSING')
      expect(agentverErr.message).toContain('dep-a')
      expect(agentverErr.message).toContain('dep-b')
    }
  })
})

// ---------------------------------------------------------------------------
// enforceConflicts
// ---------------------------------------------------------------------------

describe('enforceConflicts', () => {
  it('does nothing when conflictsWith is empty', () => {
    const manifest = createManifest()
    expect(() => enforceConflicts([], manifest, 'my-skill')).not.toThrow()
  })

  it('does nothing when no conflicting packages are installed', () => {
    const manifest = createManifest({
      packages: {
        'other-skill': createManifestPackage(),
      },
    })
    expect(() => enforceConflicts(['rival-skill'], manifest, 'my-skill')).not.toThrow()
  })

  it('throws CONFLICT_DETECTED when a conflicting package is installed', () => {
    const manifest = createManifest({
      packages: {
        'rival-skill': createManifestPackage(),
      },
    })

    expect(() => enforceConflicts(['rival-skill'], manifest, 'my-skill')).toThrow(AgentverError)

    try {
      enforceConflicts(['rival-skill'], manifest, 'my-skill')
    } catch (error) {
      const agentverErr = error as AgentverError
      expect(agentverErr.code).toBe('CONFLICT_DETECTED')
      expect(agentverErr.message).toContain('rival-skill')
      expect(agentverErr.message).toContain('my-skill')
    }
  })

  it('lists all conflicting packages in the error message', () => {
    const manifest = createManifest({
      packages: {
        'conflict-a': createManifestPackage(),
        'conflict-b': createManifestPackage(),
      },
    })

    try {
      enforceConflicts(['conflict-a', 'conflict-b', 'not-installed'], manifest, 'my-skill')
    } catch (error) {
      const agentverErr = error as AgentverError
      expect(agentverErr.code).toBe('CONFLICT_DETECTED')
      expect(agentverErr.message).toContain('conflict-a')
      expect(agentverErr.message).toContain('conflict-b')
      expect(agentverErr.message).not.toContain('not-installed')
    }
  })
})

// ---------------------------------------------------------------------------
// findReverseDependencies
// ---------------------------------------------------------------------------

describe('findReverseDependencies', () => {
  it('returns empty array when no packages depend on the target', () => {
    const manifest = createManifest({
      packages: {
        'skill-a': createManifestPackage(),
        'skill-b': createManifestPackage(),
      },
    })

    const result = findReverseDependencies('skill-a', manifest)
    expect(result).toEqual([])
  })

  it('finds packages that depend on the target', () => {
    const manifest = createManifest({
      packages: {
        'base-skill': createManifestPackage(),
        'dependent-skill': createManifestPackage({
          dependsOn: ['base-skill'],
        }),
        'another-dependent': createManifestPackage({
          dependsOn: ['base-skill', 'other'],
        }),
        'unrelated-skill': createManifestPackage(),
      },
    })

    const result = findReverseDependencies('base-skill', manifest)
    expect(result).toHaveLength(2)
    expect(result.map((d) => d.name).sort()).toEqual(['another-dependent', 'dependent-skill'])
  })

  it('does not include the target package itself', () => {
    const manifest = createManifest({
      packages: {
        'self-dep': createManifestPackage({
          dependsOn: ['self-dep'],
        }),
      },
    })

    const result = findReverseDependencies('self-dep', manifest)
    expect(result).toEqual([])
  })

  it('returns empty array for empty manifest', () => {
    const manifest = createManifest()
    const result = findReverseDependencies('any-skill', manifest)
    expect(result).toEqual([])
  })
})
