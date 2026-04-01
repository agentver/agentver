import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSkillMd } from '../helpers/fixtures'
import { seedProject, withTempDir } from '../helpers/mock-fs'
import { runCliJson, setupInstalledSkill } from './helpers'

type DoctorCheck = { name: string; status: string; message: string }
type DoctorOutput = {
  checks: DoctorCheck[]
  passed: number
  failed: number
  warnings: number
}

describe('E2E: doctor failure modes', () => {
  it('detects corrupt manifest JSON', async () => {
    await withTempDir(async (dir) => {
      const agentverDir = join(dir, '.agentver')
      mkdirSync(agentverDir, { recursive: true })
      writeFileSync(join(agentverDir, 'manifest.json'), '{not json')

      const { data } = await runCliJson<DoctorOutput>(['doctor', '--json'], { cwd: dir })

      const manifestCheck = data.checks.find((c) => c.name === 'manifest-integrity')
      expect(manifestCheck?.status).toBe('fail')
    })
  })

  it('detects corrupt lockfile JSON', async () => {
    await withTempDir(async (dir) => {
      seedProject(dir, {
        manifest: { version: 2, packages: {} },
      })

      const agentverDir = join(dir, '.agentver')
      writeFileSync(join(agentverDir, 'lockfile.json'), '{not json')

      const { data } = await runCliJson<DoctorOutput>(['doctor', '--json'], { cwd: dir })

      const lockfileCheck = data.checks.find((c) => c.name === 'lockfile-integrity')
      expect(lockfileCheck?.status).toBe('fail')
    })
  })

  it('detects manifest-lockfile sync mismatch — extra manifest entry', async () => {
    await withTempDir(async (dir) => {
      seedProject(dir, {
        manifest: {
          version: 2,
          packages: {
            'test-skill': {
              source: {
                type: 'git',
                uri: 'https://github.com/test-org/test-repo',
                path: 'skills/test-skill',
                ref: 'main',
                commit: 'abc1234567',
              },
              agents: ['claude-code'],
              installedAt: '2025-01-15T10:30:00.000Z',
              modified: false,
            },
          },
        },
        lockfile: { version: 2, packages: {} },
      })

      const { data } = await runCliJson<DoctorOutput>(['doctor', '--json'], { cwd: dir })

      const syncCheck = data.checks.find((c) => c.name === 'manifest-lockfile-sync')
      expect(syncCheck?.status).toBe('fail')
      expect(syncCheck?.message).toContain('in manifest but not lockfile')
    })
  })

  it('detects manifest-lockfile sync mismatch — extra lockfile entry', async () => {
    await withTempDir(async (dir) => {
      seedProject(dir, {
        manifest: { version: 2, packages: {} },
        lockfile: {
          version: 2,
          packages: {
            'test-skill': {
              source: {
                type: 'git',
                uri: 'https://github.com/test-org/test-repo',
                path: 'skills/test-skill',
                ref: 'main',
                commit: 'abc1234567',
              },
              integrity: 'sha256-abc123def456',
              agents: ['claude-code'],
            },
          },
        },
      })

      const { data } = await runCliJson<DoctorOutput>(['doctor', '--json'], { cwd: dir })

      const syncCheck = data.checks.find((c) => c.name === 'manifest-lockfile-sync')
      expect(syncCheck?.status).toBe('fail')
      expect(syncCheck?.message).toContain('in lockfile but not manifest')
    })
  })

  it('reports all check names in output', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'test-skill',
        files: { 'SKILL.md': createSkillMd() },
        agents: ['claude-code'],
      })

      const { data } = await runCliJson<DoctorOutput>(['doctor', '--json'], { cwd: dir })

      const checkNames = data.checks.map((c) => c.name)

      const expectedChecks = [
        'manifest-integrity',
        'lockfile-integrity',
        'manifest-lockfile-sync',
        'skill-files-exist',
        'symlinks-valid',
        'git-available',
        'node-version',
      ]

      for (const name of expectedChecks) {
        expect(checkNames, `expected check "${name}" to be present`).toContain(name)
      }
    })
  })

  it('passes git-available when git is installed', async () => {
    await withTempDir(async (dir) => {
      const { data } = await runCliJson<DoctorOutput>(['doctor', '--json'], { cwd: dir })

      const gitCheck = data.checks.find((c) => c.name === 'git-available')
      expect(gitCheck?.status).toBe('pass')
    })
  })

  it('passes node-version check', async () => {
    await withTempDir(async (dir) => {
      const { data } = await runCliJson<DoctorOutput>(['doctor', '--json'], { cwd: dir })

      const nodeCheck = data.checks.find((c) => c.name === 'node-version')
      expect(nodeCheck?.status).toBe('pass')
    })
  })

  it('multiple failures are all reported', async () => {
    await withTempDir(async (dir) => {
      // Manifest has an entry but lockfile is empty (sync mismatch)
      // and no canonical skill files exist (skill-files-exist fails)
      seedProject(dir, {
        manifest: {
          version: 2,
          packages: {
            'missing-skill': {
              source: {
                type: 'git',
                uri: 'https://github.com/test-org/test-repo',
                path: 'skills/missing-skill',
                ref: 'main',
                commit: 'abc1234567',
              },
              agents: ['claude-code'],
              installedAt: '2025-01-15T10:30:00.000Z',
              modified: false,
            },
          },
        },
        lockfile: { version: 2, packages: {} },
      })

      const { data } = await runCliJson<DoctorOutput>(['doctor', '--json'], { cwd: dir })

      const syncCheck = data.checks.find((c) => c.name === 'manifest-lockfile-sync')
      const filesCheck = data.checks.find((c) => c.name === 'skill-files-exist')

      expect(syncCheck?.status).toBe('fail')
      expect(filesCheck?.status).toBe('fail')
      expect(data.failed).toBeGreaterThan(1)
    })
  })
})
