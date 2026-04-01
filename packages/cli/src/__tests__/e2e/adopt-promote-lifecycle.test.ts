/**
 * E2E tests for the adopt -> promote lifecycle.
 * Validates that existing skills can be discovered, adopted into management,
 * and promoted from local to git sources.
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { lockfileV2Schema, manifestV2Schema } from '@agentver/shared'
import { describe, expect, it } from 'vitest'
import { createSkillMd } from '../helpers/fixtures'
import { readProjectState, withTempDir } from '../helpers/mock-fs'
import { runCliJson, setupInstalledSkill } from './helpers'

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
}

function gitExec(cmd: string, dir: string): void {
  execSync(cmd, {
    cwd: dir,
    env: { ...process.env, HOME: dir, ...GIT_ENV },
    stdio: 'pipe',
  })
}

/**
 * Initialises a git repo with a remote and an initial commit containing
 * all current files. Use this AFTER setting up the directory contents
 * you want committed.
 */
function initGitRepoWithAllFiles(
  dir: string,
  remote = 'https://github.com/test-user/test-repo.git'
): void {
  gitExec('git init', dir)
  gitExec(`git remote add origin ${remote}`, dir)
  gitExec('git add .', dir)
  gitExec('git commit -m "initial commit"', dir)
}

/**
 * Initialises an empty git repo with a remote and a single empty commit.
 * Subsequent content should be added and committed separately.
 */
function initEmptyGitRepo(
  dir: string,
  remote = 'https://github.com/test-user/test-repo.git'
): void {
  gitExec('git init', dir)
  gitExec(`git remote add origin ${remote}`, dir)
  gitExec('git commit -m "initial commit" --allow-empty', dir)
}

// ---------------------------------------------------------------------------
// Adopt lifecycle
// ---------------------------------------------------------------------------

describe('E2E: adopt lifecycle', () => {
  it('adopts a SKILL.md with local source when not in git repo', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/my-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'my-skill' }))

      const { data, exitCode } = await runCliJson<{
        adopted: Array<{ name: string; path: string; type: string }>
        skipped: Array<{ name: string }>
      }>(['adopt', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.adopted.length).toBeGreaterThanOrEqual(1)
      expect(data.adopted.some((a) => a.name === 'my-skill')).toBe(true)

      const state = readProjectState(dir)
      expect(state.manifest).not.toBeNull()
      expect(state.lockfile).not.toBeNull()

      const manifestPkg = Object.values(state.manifest!.packages).find((p) => p.name === 'my-skill')
      expect(manifestPkg).toBeDefined()
      expect(manifestPkg!.source.type).toBe('local')

      const lockfilePkg = Object.values(state.lockfile!.packages).find((p) => p.name === 'my-skill')
      expect(lockfilePkg).toBeDefined()
      expect(lockfilePkg!.integrity).toMatch(/^sha256-/)

      const manifestRaw = readFileSync(join(dir, '.agentver/manifest.json'), 'utf-8')
      expect(manifestV2Schema.safeParse(JSON.parse(manifestRaw) as unknown).success).toBe(true)

      const lockfileRaw = readFileSync(join(dir, '.agentver/lockfile.json'), 'utf-8')
      expect(lockfileV2Schema.safeParse(JSON.parse(lockfileRaw) as unknown).success).toBe(true)
    })
  })

  it('adopts skill in git repo with git source', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, '.gitkeep'), '')
      initEmptyGitRepo(dir)

      const skillDir = join(dir, '.claude/skills/git-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'git-skill' }))

      gitExec('git add .', dir)
      gitExec('git commit -m "add git-skill"', dir)

      const { data, exitCode } = await runCliJson<{
        adopted: Array<{ name: string }>
        skipped: Array<{ name: string }>
      }>(['adopt', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.adopted.some((a) => a.name === 'git-skill')).toBe(true)

      const state = readProjectState(dir)
      const manifestPkg = Object.values(state.manifest!.packages).find(
        (p) => p.name === 'git-skill'
      )
      expect(manifestPkg).toBeDefined()
      expect(manifestPkg!.source.type).toBe('git')
      expect((manifestPkg!.source as { type: 'git'; uri: string }).uri).toContain(
        'github.com/test-user/test-repo'
      )
    })
  })

  it('adopt --dry-run makes no filesystem changes', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/dry-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'dry-skill' }))

      const { exitCode, data } = await runCliJson<{
        adopted: Array<{ name: string }>
        skipped: Array<{ name: string }>
      }>(['adopt', '--dry-run', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.adopted.some((a) => a.name === 'dry-skill')).toBe(true)

      expect(existsSync(join(dir, '.agentver/manifest.json'))).toBe(false)
      expect(existsSync(join(dir, '.agentver/lockfile.json'))).toBe(false)
    })
  })

  it('adopt skips already-managed skills', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/managed-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'managed-skill' }))

      await runCliJson(['adopt', '--json'], { cwd: dir })

      const { data, exitCode } = await runCliJson<{
        adopted: Array<{ name: string }>
        skipped: Array<{ name: string; reason: string }>
      }>(['adopt', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.adopted.some((a) => a.name === 'managed-skill')).toBe(false)
      expect(data.skipped.some((s) => s.name === 'managed-skill')).toBe(true)
    })
  })

  it('adopt --name filters to matching skill', async () => {
    await withTempDir(async (dir) => {
      for (const name of ['skill-a', 'skill-b']) {
        const skillDir = join(dir, `.claude/skills/${name}`)
        mkdirSync(skillDir, { recursive: true })
        writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name }))
      }

      const { data, exitCode } = await runCliJson<{
        adopted: Array<{ name: string }>
        skipped: Array<{ name: string }>
      }>(['adopt', '--name', 'skill-a', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(data.adopted.some((a) => a.name === 'skill-a')).toBe(true)
      expect(data.adopted.some((a) => a.name === 'skill-b')).toBe(false)
    })
  })

  it('adopt computes integrity from skill directory files', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/integrity-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'integrity-skill' }))
      writeFileSync(join(skillDir, 'helpers.txt'), 'Reference content for the skill.\n')

      const { exitCode } = await runCliJson(['adopt', '--json'], { cwd: dir })
      expect(exitCode).toBe(0)

      const state = readProjectState(dir)
      expect(Object.keys(state.lockfile!.packages).length).toBeGreaterThanOrEqual(1)

      const lockfileEntries = Object.values(state.lockfile!.packages)
      for (const entry of lockfileEntries) {
        expect(entry.integrity).toMatch(/^sha256-/)
        expect(entry.integrity.length).toBeGreaterThan(10)
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Promote lifecycle
// ---------------------------------------------------------------------------

describe('E2E: promote lifecycle', () => {
  it('promote --to git updates source from local to git', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/promote-me')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'promote-me' }))

      const adoptResult = await runCliJson<{
        adopted: Array<{ name: string }>
      }>(['adopt', '--json'], { cwd: dir })
      expect(adoptResult.exitCode).toBe(0)

      const stateBefore = readProjectState(dir)
      const localPkg = Object.values(stateBefore.manifest!.packages).find(
        (p) => p.name === 'promote-me'
      )
      expect(localPkg!.source.type).toBe('local')

      initGitRepoWithAllFiles(dir)

      const { data, exitCode, success } = await runCliJson<{
        type: string
        packageKey: string
        displayName: string
        previousSource: { type: string }
        newSource: { type: string; uri: string }
      }>(['promote', 'promote-me', '--to', 'git', '--yes', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.displayName).toBe('promote-me')
      expect(data.previousSource.type).toBe('local')
      expect(data.newSource.type).toBe('git')

      const stateAfter = readProjectState(dir)
      const gitPkg = Object.values(stateAfter.manifest!.packages).find(
        (p) => p.name === 'promote-me'
      )
      expect(gitPkg).toBeDefined()
      expect(gitPkg!.source.type).toBe('git')
    })
  })

  it('promote --to git --dry-run makes no changes', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/dry-promote')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'dry-promote' }))

      await runCliJson(['adopt', '--json'], { cwd: dir })

      const stateBefore = readProjectState(dir)
      const localPkg = Object.values(stateBefore.manifest!.packages).find(
        (p) => p.name === 'dry-promote'
      )
      expect(localPkg!.source.type).toBe('local')

      initGitRepoWithAllFiles(dir)

      const { exitCode } = await runCliJson(
        ['promote', 'dry-promote', '--to', 'git', '--dry-run', '--json'],
        { cwd: dir }
      )
      expect(exitCode).toBe(0)

      const stateAfter = readProjectState(dir)
      const stillLocal = Object.values(stateAfter.manifest!.packages).find(
        (p) => p.name === 'dry-promote'
      )
      expect(stillLocal).toBeDefined()
      expect(stillLocal!.source.type).toBe('local')
    })
  })

  it('promote fails for non-promotable entry', async () => {
    await withTempDir(async (dir) => {
      setupInstalledSkill(dir, {
        name: 'already-git',
        files: { 'SKILL.md': createSkillMd({ name: 'already-git' }) },
        agents: ['claude-code'],
      })

      const { success, exitCode } = await runCliJson(
        ['promote', 'already-git', '--to', 'git', '--json'],
        { cwd: dir }
      )

      expect(exitCode).not.toBe(0)
      expect(success).toBe(false)
    })
  })

  it('promote --all --to git promotes all local entries', async () => {
    await withTempDir(async (dir) => {
      for (const name of ['local-a', 'local-b']) {
        const skillDir = join(dir, `.claude/skills/${name}`)
        mkdirSync(skillDir, { recursive: true })
        writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name }))
      }

      await runCliJson(['adopt', '--json'], { cwd: dir })

      const stateBefore = readProjectState(dir)
      for (const pkg of Object.values(stateBefore.manifest!.packages)) {
        expect(pkg.source.type).toBe('local')
      }

      initGitRepoWithAllFiles(dir)

      const { data, exitCode, success } = await runCliJson<{
        promoted: Array<{
          displayName: string
          previousSource: { type: string }
          newSource: { type: string }
        }>
        errors: Array<{ name: string; error: string }>
      }>(['promote', '--all', '--to', 'git', '--yes', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.promoted.length).toBe(2)

      const promotedNames = data.promoted.map((p) => p.displayName).sort()
      expect(promotedNames).toEqual(['local-a', 'local-b'])

      for (const entry of data.promoted) {
        expect(entry.previousSource.type).toBe('local')
        expect(entry.newSource.type).toBe('git')
      }

      const stateAfter = readProjectState(dir)
      for (const pkg of Object.values(stateAfter.manifest!.packages)) {
        expect(pkg.source.type).toBe('git')
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Reclassify
// ---------------------------------------------------------------------------

describe('E2E: reclassify', () => {
  it('reclassify upgrades local entries when git context becomes available', async () => {
    await withTempDir(async (dir) => {
      const skillDir = join(dir, '.claude/skills/reclass-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), createSkillMd({ name: 'reclass-skill' }))

      await runCliJson(['adopt', '--json'], { cwd: dir })

      const stateBefore = readProjectState(dir)
      const localPkg = Object.values(stateBefore.manifest!.packages).find(
        (p) => p.name === 'reclass-skill'
      )
      expect(localPkg).toBeDefined()
      expect(localPkg!.source.type).toBe('local')

      initGitRepoWithAllFiles(dir)

      const { exitCode, success } = await runCliJson<{
        adopted: Array<{ name: string }>
        skipped: Array<{ name: string }>
      }>(['adopt', '--reclassify', '--json'], { cwd: dir })

      expect(exitCode).toBe(0)
      expect(success).toBe(true)

      const stateAfter = readProjectState(dir)
      const reclassifiedPkg = Object.values(stateAfter.manifest!.packages).find(
        (p) => p.name === 'reclass-skill'
      )
      expect(reclassifiedPkg).toBeDefined()
      expect(reclassifiedPkg!.source.type).toBe('git')

      const lockfilePkg = Object.values(stateAfter.lockfile!.packages).find(
        (p) => p.name === 'reclass-skill'
      )
      expect(lockfilePkg).toBeDefined()
      expect(lockfilePkg!.source.type).toBe('git')
    })
  })
})
