import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('@agentver/agent-definitions', () => ({
  detectInstalledAgents: vi.fn().mockReturnValue([{ id: 'claude-code' }]),
  getSkillPlacementPath: vi.fn().mockReturnValue('.claude/skills/test-skill'),
  getAgentPlacementPath: vi.fn().mockReturnValue('.claude/agents/test-agent.md'),
  getCommandPlacementPath: vi.fn().mockReturnValue('.claude/commands/test-command.md'),
}))

vi.mock('@agentver/storage', () => ({
  computeIntegrity: vi.fn().mockReturnValue('sha256-disc-hash'),
  getDisplayName: vi.fn((key: string, pkg: { name?: string }) => pkg.name?.trim() || key),
  updateManifestAndLockfile: vi.fn(),
  setManifestPackage: vi.fn(),
  setLockfilePackage: vi.fn(),
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue('/home/testuser'),
  }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { detectInstalledAgents, getSkillPlacementPath } from '@agentver/agent-definitions'
import type { InstallRequest, PackageType } from '../index'
import { classifySource, planInstall, planRestore } from '../index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

function createTestRequest(overrides?: Partial<InstallRequest>): InstallRequest {
  return {
    packageKey: 'git:test-key',
    displayName: 'test-org/test-skill',
    packageType: 'SKILL',
    source: {
      type: 'git',
      uri: 'https://github.com/test-org/repo',
      path: 'skills/test',
      ref: 'main',
      commit: 'abc1234567',
    },
    files: [{ path: 'SKILL.md', content: '# Test skill' }],
    integrity: 'sha256-test',
    target: { scope: 'project', projectRoot: tmpDir, agents: ['claude-code'] },
    policy: {
      conflictStrategy: 'error',
      preferredLinkMode: 'symlink',
      allowFallback: true,
      dryRun: false,
      persist: true,
      securityScanPolicy: 'skip',
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('planner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = mkdtempSync(join(tmpdir(), 'agentver-planner-test-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe('planInstall', () => {
    it('resolves canonical path for skills (.agents/skills/<name>/)', () => {
      const plan = planInstall(createTestRequest())

      expect(plan.canonical.path).toBe(join(tmpDir, '.agents', 'skills', 'test-org/test-skill'))
      expect(plan.canonical.category).toBe('skills')
    })

    it('resolves canonical path for agents (.agents/agents/<name>.md)', () => {
      const plan = planInstall(
        createTestRequest({
          packageType: 'AGENT',
          displayName: 'test-agent',
        })
      )

      expect(plan.canonical.path).toBe(join(tmpDir, '.agents', 'agents', 'test-agent.md'))
      expect(plan.canonical.category).toBe('agents')
    })

    it('resolves canonical path for commands (.agents/commands/<name>.md)', () => {
      const plan = planInstall(
        createTestRequest({
          packageType: 'COMMAND',
          displayName: 'test-command',
        })
      )

      expect(plan.canonical.path).toBe(join(tmpDir, '.agents', 'commands', 'test-command.md'))
      expect(plan.canonical.category).toBe('commands')
    })

    it('auto-detects agents when target.agents is empty', () => {
      const plan = planInstall(
        createTestRequest({
          target: { scope: 'project', projectRoot: tmpDir, agents: [] },
        })
      )

      expect(detectInstalledAgents).toHaveBeenCalledWith(tmpDir)
      expect(plan.manifestEntry.agents).toEqual(['claude-code'])
    })

    it('validates files for path traversal — skips ".." paths', () => {
      const plan = planInstall(
        createTestRequest({
          files: [
            { path: 'SKILL.md', content: '# OK' },
            { path: '../escape.md', content: '# Evil' },
          ],
        })
      )

      expect(plan.skippedFiles).toHaveLength(1)
      expect(plan.skippedFiles[0]?.path).toBe('../escape.md')
      expect(plan.skippedFiles[0]?.reason).toContain('..')
    })

    it('validates files for path traversal — skips absolute paths', () => {
      const plan = planInstall(
        createTestRequest({
          files: [
            { path: 'SKILL.md', content: '# OK' },
            { path: '/etc/passwd', content: '# Evil' },
          ],
        })
      )

      expect(plan.skippedFiles).toHaveLength(1)
      expect(plan.skippedFiles[0]?.path).toBe('/etc/passwd')
      expect(plan.skippedFiles[0]?.reason).toContain('Absolute')
    })

    it('detects conflicts at placement paths', () => {
      // Create a conflicting file at the placement path
      const placementPath = join(tmpDir, '.claude', 'skills', 'test-skill')
      mkdirSync(placementPath, { recursive: true })
      writeFileSync(join(placementPath, 'SKILL.md'), '# Existing', 'utf-8')

      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue('.claude/skills/test-skill')

      const plan = planInstall(
        createTestRequest({
          displayName: 'test-skill',
        })
      )

      expect(plan.conflicts.length).toBeGreaterThan(0)
    })

    it('conflict strategy "error" makes plan non-executable when conflicts exist', () => {
      const placementPath = join(tmpDir, '.claude', 'skills', 'test-skill')
      mkdirSync(placementPath, { recursive: true })
      writeFileSync(join(placementPath, 'SKILL.md'), '# Existing', 'utf-8')

      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue('.claude/skills/test-skill')

      const plan = planInstall(
        createTestRequest({
          displayName: 'test-skill',
          policy: {
            conflictStrategy: 'error',
            preferredLinkMode: 'symlink',
            allowFallback: true,
            dryRun: false,
            persist: true,
            securityScanPolicy: 'skip',
          },
        })
      )

      expect(plan.executable).toBe(false)
      expect(plan.blockedReason).toBeTruthy()
    })

    it('conflict strategy "backup-and-replace" populates backupsRequired', () => {
      const placementPath = join(tmpDir, '.claude', 'skills', 'test-skill')
      mkdirSync(placementPath, { recursive: true })
      writeFileSync(join(placementPath, 'SKILL.md'), '# Existing', 'utf-8')

      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue('.claude/skills/test-skill')

      const plan = planInstall(
        createTestRequest({
          displayName: 'test-skill',
          policy: {
            conflictStrategy: 'backup-and-replace',
            preferredLinkMode: 'symlink',
            allowFallback: true,
            dryRun: false,
            persist: true,
            securityScanPolicy: 'skip',
          },
        })
      )

      expect(plan.executable).toBe(true)
      expect(plan.backupsRequired.length).toBeGreaterThan(0)
      expect(plan.backupsRequired[0]?.reason).toBe('conflict-replace')
    })

    it('conflict strategy "skip" filters out conflicting placements', () => {
      const placementPath = join(tmpDir, '.claude', 'skills', 'test-skill')
      mkdirSync(placementPath, { recursive: true })
      writeFileSync(join(placementPath, 'SKILL.md'), '# Existing', 'utf-8')

      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue('.claude/skills/test-skill')

      const plan = planInstall(
        createTestRequest({
          displayName: 'test-skill',
          policy: {
            conflictStrategy: 'skip',
            preferredLinkMode: 'symlink',
            allowFallback: true,
            dryRun: false,
            persist: true,
            securityScanPolicy: 'skip',
          },
        })
      )

      expect(plan.executable).toBe(true)
      // Conflicting placements should be filtered out
      const conflictPaths = new Set(plan.conflicts.map((c) => c.path))
      for (const placement of plan.placements) {
        expect(conflictPaths.has(placement.destinationPath)).toBe(false)
      }
    })

    it('conflict strategy "force" keeps all placements', () => {
      const placementPath = join(tmpDir, '.claude', 'skills', 'test-skill')
      mkdirSync(placementPath, { recursive: true })
      writeFileSync(join(placementPath, 'SKILL.md'), '# Existing', 'utf-8')

      const mockGetSkill = vi.mocked(getSkillPlacementPath)
      mockGetSkill.mockReturnValue('.claude/skills/test-skill')

      const plan = planInstall(
        createTestRequest({
          displayName: 'test-skill',
          policy: {
            conflictStrategy: 'force',
            preferredLinkMode: 'symlink',
            allowFallback: true,
            dryRun: false,
            persist: true,
            securityScanPolicy: 'skip',
          },
        })
      )

      expect(plan.executable).toBe(true)
      expect(plan.backupsRequired).toEqual([])
      expect(plan.placements.length).toBeGreaterThanOrEqual(1)
    })

    it('builds correct manifest entry', () => {
      const plan = planInstall(createTestRequest())

      expect(plan.manifestEntry.name).toBe('test-org/test-skill')
      expect(plan.manifestEntry.source.type).toBe('git')
      expect(plan.manifestEntry.agents).toEqual(['claude-code'])
      expect(plan.manifestEntry.installedAt).toBeTruthy()
      expect(plan.manifestEntry.packageType).toBe('SKILL')
      expect(plan.manifestEntry.modified).toBe(false)
    })

    it('builds correct lockfile entry', () => {
      const plan = planInstall(createTestRequest())

      expect(plan.lockfileEntry.name).toBe('test-org/test-skill')
      expect(plan.lockfileEntry.source.type).toBe('git')
      expect(plan.lockfileEntry.integrity).toBe('sha256-test')
      expect(plan.lockfileEntry.agents).toEqual(['claude-code'])
    })

    it('custom path override bypasses canonical resolution', () => {
      const customPath = '.custom/my-skill'

      const plan = planInstall(
        createTestRequest({
          metadata: { customPath },
        })
      )

      expect(plan.canonical.path).toBe(join(tmpDir, customPath))
      // Custom path installs have no agent placements
      expect(plan.placements).toEqual([])
      // Custom path installs skip conflict detection
      expect(plan.conflicts).toEqual([])
    })

    it('bundle parent key recorded in manifest entry', () => {
      const plan = planInstall(
        createTestRequest({
          metadata: { bundleParentKey: 'git:parent-bundle' },
        })
      )

      expect(plan.manifestEntry.bundle).toBe('git:parent-bundle')
    })

    it('entry file recorded for AGENT/COMMAND types', () => {
      const plan = planInstall(
        createTestRequest({
          packageType: 'AGENT',
          displayName: 'test-agent',
          metadata: { entryFile: 'agent.md' },
        })
      )

      expect(plan.manifestEntry.entryFile).toBe('agent.md')
    })

    it('records dependsOn in manifest entry', () => {
      const plan = planInstall(
        createTestRequest({
          metadata: { dependsOn: ['git:dep-a', 'git:dep-b'] },
        })
      )

      expect(plan.manifestEntry.dependsOn).toEqual(['git:dep-a', 'git:dep-b'])
    })

    it('records conflictsWith in manifest entry', () => {
      const plan = planInstall(
        createTestRequest({
          metadata: { conflictsWith: ['git:rival'] },
        })
      )

      expect(plan.manifestEntry.conflictsWith).toEqual(['git:rival'])
    })

    it('marks plan as update when isUpdate metadata is set', () => {
      const plan = planInstall(
        createTestRequest({
          metadata: { isUpdate: true },
        })
      )

      expect(plan.kind).toBe('update')
    })

    it('marks plan as fresh by default', () => {
      const plan = planInstall(createTestRequest())
      expect(plan.kind).toBe('fresh')
    })
  })

  describe('planRestore', () => {
    const gitSource = {
      type: 'git' as const,
      uri: 'https://github.com/org/repo',
      path: 'skills/test',
      ref: 'main',
      commit: 'abc123',
    }

    const localSource = {
      type: 'local' as const,
      path: '/some/local/path',
    }

    const platformSource = {
      type: 'platform' as const,
      uri: 'agentver://org/skill',
      path: 'skills/test',
      ref: 'main',
      commit: 'def456',
    }

    const wellKnownSource = {
      type: 'well-known' as const,
      baseUrl: 'https://skills.sh/skill',
      hostname: 'skills.sh',
    }

    function createPolicy(overrides?: Partial<Parameters<typeof planRestore>[2]>) {
      return {
        projectRoot: tmpDir,
        scope: 'project' as const,
        agents: ['claude-code'],
        preferredLinkMode: 'symlink' as const,
        allowFallback: true,
        force: false,
        concurrency: 4,
        offline: false,
        securityScanPolicy: 'skip' as const,
        ...overrides,
      }
    }

    function createManifest(
      packages: Record<
        string,
        {
          name?: string
          source: Parameters<typeof planRestore>[0]['packages'][string]['source']
          agents?: string[]
          installedAt?: string
          modified?: boolean
          packageType?: string
          dependsOn?: string[]
        }
      >
    ) {
      const result: Record<string, Parameters<typeof planRestore>[0]['packages'][string]> = {}
      for (const [key, pkg] of Object.entries(packages)) {
        result[key] = {
          source: pkg.source,
          agents: pkg.agents ?? ['claude-code'],
          installedAt: pkg.installedAt ?? new Date().toISOString(),
          modified: pkg.modified ?? false,
          name: pkg.name,
          packageType: pkg.packageType as PackageType | undefined,
          dependsOn: pkg.dependsOn,
        }
      }
      return { version: 2 as const, packages: result }
    }

    function createLockfile(
      packages: Record<
        string,
        { source: { type: string; [k: string]: unknown }; integrity: string }
      >
    ) {
      const result: Record<string, Parameters<typeof planRestore>[1]['packages'][string]> = {}
      for (const [key, pkg] of Object.entries(packages)) {
        result[key] = {
          source: pkg.source as Parameters<typeof planRestore>[1]['packages'][string]['source'],
          integrity: pkg.integrity,
        }
      }
      return { version: 2 as const, packages: result }
    }

    it('classifies git sources as restorable', () => {
      const manifest = createManifest({
        'git:skill-a': { name: 'skill-a', source: gitSource },
      })
      const lockfile = createLockfile({
        'git:skill-a': { source: gitSource, integrity: 'sha256-abc' },
      })

      const plan = planRestore(manifest, lockfile, createPolicy())

      expect(plan.toInstall.length + plan.upToDate.length).toBe(1)
      expect(plan.toSkip).toHaveLength(0)
    })

    it('classifies platform sources as restorable', () => {
      const manifest = createManifest({
        'platform:skill-a': { name: 'skill-a', source: platformSource },
      })
      const lockfile = createLockfile({
        'platform:skill-a': { source: platformSource, integrity: 'sha256-abc' },
      })

      const plan = planRestore(manifest, lockfile, createPolicy())

      expect(plan.toInstall.length + plan.upToDate.length).toBe(1)
      expect(plan.toSkip).toHaveLength(0)
    })

    it('classifies well-known sources as restorable', () => {
      const manifest = createManifest({
        'wk:skill-a': { name: 'skill-a', source: wellKnownSource },
      })
      const lockfile = createLockfile({
        'wk:skill-a': { source: wellKnownSource, integrity: 'sha256-abc' },
      })

      const plan = planRestore(manifest, lockfile, createPolicy())

      expect(plan.toInstall.length + plan.upToDate.length).toBe(1)
      expect(plan.toSkip).toHaveLength(0)
    })

    it('classifies local sources as skip', () => {
      const manifest = createManifest({
        'local:skill-a': { name: 'skill-a', source: localSource },
      })
      const lockfile = createLockfile({
        'local:skill-a': { source: localSource, integrity: 'sha256-abc' },
      })

      const plan = planRestore(manifest, lockfile, createPolicy())

      expect(plan.toSkip).toHaveLength(1)
      expect(plan.toSkip[0]?.reason).toContain('Local')
    })

    it('classifies unknown sources as skip', () => {
      const unknownSource = { type: 'unknown' as const }
      const manifest = createManifest({
        'unknown:skill-a': { name: 'skill-a', source: unknownSource },
      })
      const lockfile = createLockfile({
        'unknown:skill-a': { source: unknownSource, integrity: 'sha256-abc' },
      })

      const plan = planRestore(manifest, lockfile, createPolicy())

      expect(plan.toSkip).toHaveLength(1)
      expect(plan.toSkip[0]?.reason).toContain('Unknown')
    })

    it('skips bundle entries', () => {
      const manifest = createManifest({
        'git:my-bundle': {
          name: 'my-bundle',
          source: gitSource,
          packageType: 'BUNDLE',
        },
      })
      const lockfile = createLockfile({
        'git:my-bundle': { source: gitSource, integrity: 'sha256-abc' },
      })

      const plan = planRestore(manifest, lockfile, createPolicy())

      expect(plan.toSkip).toHaveLength(1)
      expect(plan.toSkip[0]?.reason).toContain('Bundle')
    })

    it('skips modified packages unless force is set', () => {
      const manifest = createManifest({
        'git:skill-mod': {
          name: 'skill-mod',
          source: gitSource,
          modified: true,
        },
      })
      const lockfile = createLockfile({
        'git:skill-mod': { source: gitSource, integrity: 'sha256-abc' },
      })

      const plan = planRestore(manifest, lockfile, createPolicy({ force: false }))

      expect(plan.toSkip).toHaveLength(1)
      expect(plan.toSkip[0]?.reason).toContain('local modifications')
    })

    it('restores modified packages when force is set', () => {
      const manifest = createManifest({
        'git:skill-mod': {
          name: 'skill-mod',
          source: gitSource,
          modified: true,
        },
      })
      const lockfile = createLockfile({
        'git:skill-mod': { source: gitSource, integrity: 'sha256-abc' },
      })

      const plan = planRestore(manifest, lockfile, createPolicy({ force: true }))

      expect(plan.toSkip).toHaveLength(0)
      expect(plan.toInstall.length + plan.upToDate.length).toBe(1)
    })

    it('detects up-to-date packages (canonical path exists + integrity matches)', () => {
      // Create on-disc skill directory with matching content
      const skillPath = join(tmpDir, '.agents', 'skills', 'up-to-date-skill')
      mkdirSync(skillPath, { recursive: true })
      writeFileSync(join(skillPath, 'SKILL.md'), '# Up to date', 'utf-8')

      // The mock computeIntegrity returns 'sha256-disc-hash' for any files
      const manifest = createManifest({
        'git:up-to-date-skill': {
          name: 'up-to-date-skill',
          source: gitSource,
        },
      })
      const lockfile = createLockfile({
        'git:up-to-date-skill': { source: gitSource, integrity: 'sha256-disc-hash' },
      })

      const plan = planRestore(manifest, lockfile, createPolicy())

      expect(plan.upToDate).toHaveLength(1)
      expect(plan.upToDate[0]?.alreadyInstalled).toBe(true)
    })

    it('topologically sorts by dependsOn', () => {
      const manifest = createManifest({
        'git:skill-b': {
          name: 'skill-b',
          source: gitSource,
          dependsOn: ['git:skill-a'],
        },
        'git:skill-a': {
          name: 'skill-a',
          source: gitSource,
        },
      })
      const lockfile = createLockfile({
        'git:skill-b': { source: gitSource, integrity: 'sha256-b' },
        'git:skill-a': { source: gitSource, integrity: 'sha256-a' },
      })

      const plan = planRestore(manifest, lockfile, createPolicy())

      // skill-a should come before skill-b due to dependency
      const aIndex = plan.toInstall.findIndex((e) => e.packageKey === 'git:skill-a')
      const bIndex = plan.toInstall.findIndex((e) => e.packageKey === 'git:skill-b')
      expect(aIndex).toBeLessThan(bIndex)
    })

    it('handles circular dependencies without crashing', () => {
      const manifest = createManifest({
        'git:skill-a': {
          name: 'skill-a',
          source: gitSource,
          dependsOn: ['git:skill-b'],
        },
        'git:skill-b': {
          name: 'skill-b',
          source: gitSource,
          dependsOn: ['git:skill-a'],
        },
      })
      const lockfile = createLockfile({
        'git:skill-a': { source: gitSource, integrity: 'sha256-a' },
        'git:skill-b': { source: gitSource, integrity: 'sha256-b' },
      })

      const plan = planRestore(manifest, lockfile, createPolicy())

      // Both entries should be present (cycle falls back to insertion order)
      expect(plan.toInstall).toHaveLength(2)
      const keys = plan.toInstall.map((e) => e.packageKey)
      expect(keys).toContain('git:skill-a')
      expect(keys).toContain('git:skill-b')
    })

    it('places package in toInstall when lockfile entry is missing', () => {
      const manifest = createManifest({
        'git:orphaned-skill': {
          name: 'orphaned-skill',
          source: gitSource,
        },
      })
      // Lockfile has no matching entry for 'git:orphaned-skill'
      const lockfile = createLockfile({})

      const plan = planRestore(manifest, lockfile, createPolicy())

      expect(plan.toInstall).toHaveLength(1)
      expect(plan.toInstall[0]?.packageKey).toBe('git:orphaned-skill')
      expect(plan.upToDate).toHaveLength(0)
    })

    it('auto-detects agents when policy.agents is empty', () => {
      const manifest = createManifest({
        'git:skill-a': { name: 'skill-a', source: gitSource },
      })
      const lockfile = createLockfile({
        'git:skill-a': { source: gitSource, integrity: 'sha256-abc' },
      })

      const plan = planRestore(manifest, lockfile, createPolicy({ agents: [] }))

      expect(detectInstalledAgents).toHaveBeenCalledWith(tmpDir)
      expect(plan.agents).toEqual(['claude-code'])
    })
  })

  describe('classifySource', () => {
    it('classifies git source as restorable with git strategy', () => {
      const result = classifySource({
        type: 'git',
        uri: 'https://github.com/org/repo',
        path: 'skills/test',
        ref: 'main',
        commit: 'abc123',
      })

      expect(result.kind).toBe('restorable')
      if (result.kind === 'restorable') {
        expect(result.fetchStrategy).toBe('git')
      }
    })

    it('classifies platform source as restorable with platform strategy', () => {
      const result = classifySource({
        type: 'platform',
        uri: 'agentver://org/skill',
        path: 'skills/test',
        ref: 'main',
        commit: 'def456',
      })

      expect(result.kind).toBe('restorable')
      if (result.kind === 'restorable') {
        expect(result.fetchStrategy).toBe('platform')
      }
    })

    it('classifies well-known source as restorable with well-known strategy', () => {
      const result = classifySource({
        type: 'well-known',
        baseUrl: 'https://skills.sh/skill',
        hostname: 'skills.sh',
      })

      expect(result.kind).toBe('restorable')
      if (result.kind === 'restorable') {
        expect(result.fetchStrategy).toBe('well-known')
      }
    })

    it('classifies local source as skip', () => {
      const result = classifySource({ type: 'local', path: '/some/path' })

      expect(result.kind).toBe('skip')
      if (result.kind === 'skip') {
        expect(result.reason).toBeTruthy()
      }
    })

    it('classifies unknown source as skip', () => {
      const result = classifySource({ type: 'unknown' })

      expect(result.kind).toBe('skip')
      if (result.kind === 'skip') {
        expect(result.reason).toBeTruthy()
      }
    })
  })
})
