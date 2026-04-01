import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createGitRepoCache,
  findGitRoot,
  getCurrentRef,
  getHeadCommit,
  getRemoteUri,
  isPathDirty,
  isSubmodulePath,
  normaliseRemoteUrl,
  resolveLocalGitContext,
} from '../../git/local-context'

const execFileAsync = promisify(execFile)

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

async function initRepo(dir: string): Promise<void> {
  await git(['init', '--initial-branch', 'main'], dir)
  await git(['config', 'user.email', 'test@agentver.com'], dir)
  await git(['config', 'user.name', 'Test'], dir)
}

// ---------------------------------------------------------------------------
// normaliseRemoteUrl — pure function, no git needed
// ---------------------------------------------------------------------------

describe('normaliseRemoteUrl', () => {
  it.each([
    ['git@github.com:owner/repo.git', 'github.com/owner/repo'],
    ['https://github.com/owner/repo.git', 'github.com/owner/repo'],
    ['https://github.com/owner/repo', 'github.com/owner/repo'],
    ['ssh://git@github.com/owner/repo.git', 'github.com/owner/repo'],
    ['git://github.com/owner/repo.git', 'github.com/owner/repo'],
    ['http://github.com/owner/repo.git', 'github.com/owner/repo'],
    ['git@gitlab.com:group/subgroup/repo.git', 'gitlab.com/group/subgroup/repo'],
    ['https://gitlab.com/group/sub/repo', 'gitlab.com/group/sub/repo'],
    ['git@bitbucket.org:team/repo.git', 'bitbucket.org/team/repo'],
    ['https://bitbucket.org/team/repo.git', 'bitbucket.org/team/repo'],
    ['git@git.company.com:org/repo.git', 'git.company.com/org/repo'],
    ['ssh://git@git.agentver.com:2222/org/repo', 'git.agentver.com/org/repo'],
    ['https://user@github.com/owner/repo.git', 'github.com/owner/repo'],
  ])('normalises "%s" to "%s"', (input, expected) => {
    expect(normaliseRemoteUrl(input)).toBe(expected)
  })

  it.each([
    ['/home/user/repos/bare.git', null],
    ['../other-repo', null],
    ['', null],
    ['   ', null],
    ['just-a-name', null],
    ['git@github.com:singlepath.git', null],
  ])('returns null for non-normalisable "%s"', (input, expected) => {
    expect(normaliseRemoteUrl(input)).toBe(expected)
  })

  it('strips trailing slashes', () => {
    expect(normaliseRemoteUrl('https://github.com/owner/repo/')).toBe('github.com/owner/repo')
  })

  it('strips .git suffix case-insensitively', () => {
    expect(normaliseRemoteUrl('https://github.com/owner/repo.GIT')).toBe('github.com/owner/repo')
  })

  it('handles URLs with extra path segments (monorepo-style)', () => {
    expect(normaliseRemoteUrl('https://github.com/owner/repo/extra/path')).toBe(
      'github.com/owner/repo/extra/path'
    )
  })
})

// ---------------------------------------------------------------------------
// Git context detection — requires actual git repos
// ---------------------------------------------------------------------------

describe('findGitRoot', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentver-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns the git root for a path inside a repo', async () => {
    await initRepo(tempDir)
    const subDir = join(tempDir, 'sub', 'nested')
    await mkdir(subDir, { recursive: true })

    const root = await findGitRoot(subDir)
    expect(root).toBe(tempDir)
  })

  it('returns null for a path outside any git repo', async () => {
    // tempDir is not initialised as a git repo
    const root = await findGitRoot(tempDir)
    expect(root).toBeNull()
  })

  it('caches results per directory', async () => {
    await initRepo(tempDir)
    const cache = createGitRepoCache()

    const root1 = await findGitRoot(tempDir, cache)
    const root2 = await findGitRoot(tempDir, cache)

    expect(root1).toBe(tempDir)
    expect(root2).toBe(tempDir)
    expect(cache.roots.get(tempDir)).toBe(tempDir)
  })
})

describe('getRemoteUri', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentver-test-'))
    await initRepo(tempDir)
    await git(['commit', '--allow-empty', '-m', 'init'], tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns null when no remotes are configured', async () => {
    const result = await getRemoteUri(tempDir)
    expect(result.uri).toBeNull()
    expect(result.remoteName).toBeNull()
  })

  it('normalises an SSH remote URL', async () => {
    await git(['remote', 'add', 'origin', 'git@github.com:agentver/agentver.git'], tempDir)

    const result = await getRemoteUri(tempDir)
    expect(result.uri).toBe('github.com/agentver/agentver')
    expect(result.remoteName).toBe('origin')
  })

  it('normalises an HTTPS remote URL', async () => {
    await git(['remote', 'add', 'origin', 'https://github.com/agentver/agentver.git'], tempDir)

    const result = await getRemoteUri(tempDir)
    expect(result.uri).toBe('github.com/agentver/agentver')
    expect(result.remoteName).toBe('origin')
  })

  it('prefers origin over upstream', async () => {
    await git(['remote', 'add', 'upstream', 'https://github.com/upstream/repo.git'], tempDir)
    await git(['remote', 'add', 'origin', 'https://github.com/origin/repo.git'], tempDir)

    const result = await getRemoteUri(tempDir)
    expect(result.uri).toBe('github.com/origin/repo')
    expect(result.remoteName).toBe('origin')
  })

  it('falls back to upstream when no origin', async () => {
    await git(['remote', 'add', 'upstream', 'https://github.com/upstream/repo.git'], tempDir)

    const result = await getRemoteUri(tempDir)
    expect(result.uri).toBe('github.com/upstream/repo')
    expect(result.remoteName).toBe('upstream')
  })

  it('falls back to first alphabetical remote', async () => {
    await git(['remote', 'add', 'zebra', 'https://github.com/z/repo.git'], tempDir)
    await git(['remote', 'add', 'alpha', 'https://github.com/a/repo.git'], tempDir)

    const result = await getRemoteUri(tempDir)
    expect(result.uri).toBe('github.com/a/repo')
    expect(result.remoteName).toBe('alpha')
  })
})

describe('getCurrentRef', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentver-test-'))
    await initRepo(tempDir)
    await git(['commit', '--allow-empty', '-m', 'init'], tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns the current branch name', async () => {
    const ref = await getCurrentRef(tempDir)
    expect(ref).toBe('main')
  })

  it('returns HEAD when in detached HEAD state', async () => {
    const sha = await git(['rev-parse', 'HEAD'], tempDir)
    await git(['checkout', sha], tempDir)

    const ref = await getCurrentRef(tempDir)
    expect(ref).toBe('HEAD')
  })
})

describe('getHeadCommit', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentver-test-'))
    await initRepo(tempDir)
    await git(['commit', '--allow-empty', '-m', 'init'], tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns the full 40-char commit SHA', async () => {
    const commit = await getHeadCommit(tempDir)
    expect(commit).toMatch(/^[a-f0-9]{40}$/)
  })
})

describe('isPathDirty', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentver-test-'))
    await initRepo(tempDir)
    const skillDir = join(tempDir, 'skills', 'my-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '# My Skill\n')
    await git(['add', '.'], tempDir)
    await git(['commit', '-m', 'add skill'], tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns false for a clean path', async () => {
    const dirty = await isPathDirty(tempDir, 'skills/my-skill')
    expect(dirty).toBe(false)
  })

  it('returns true when file has unstaged changes', async () => {
    await writeFile(join(tempDir, 'skills', 'my-skill', 'SKILL.md'), '# Modified\n')

    const dirty = await isPathDirty(tempDir, 'skills/my-skill')
    expect(dirty).toBe(true)
  })

  it('returns true when file has staged changes', async () => {
    await writeFile(join(tempDir, 'skills', 'my-skill', 'SKILL.md'), '# Staged\n')
    await git(['add', 'skills/my-skill/SKILL.md'], tempDir)

    const dirty = await isPathDirty(tempDir, 'skills/my-skill')
    expect(dirty).toBe(true)
  })

  it('returns true when there are untracked files', async () => {
    await writeFile(join(tempDir, 'skills', 'my-skill', 'new-file.md'), '# New\n')

    const dirty = await isPathDirty(tempDir, 'skills/my-skill')
    expect(dirty).toBe(true)
  })
})

describe('isSubmodulePath', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentver-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns false for a normal git repo', async () => {
    await initRepo(tempDir)
    const result = await isSubmodulePath(tempDir)
    expect(result).toBe(false)
  })

  it('returns false for a non-git directory', async () => {
    const result = await isSubmodulePath(tempDir)
    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolveLocalGitContext — full integration
// ---------------------------------------------------------------------------

describe('resolveLocalGitContext', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentver-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns null for a path outside any git repo', async () => {
    const context = await resolveLocalGitContext(tempDir)
    expect(context).toBeNull()
  })

  it('resolves full context for a skill in a git repo with remote', async () => {
    await initRepo(tempDir)
    const skillDir = join(tempDir, '.claude', 'skills', 'my-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '# My Skill\n')
    await git(['add', '.'], tempDir)
    await git(['commit', '-m', 'add skill'], tempDir)
    await git(['remote', 'add', 'origin', 'git@github.com:agentver/skills.git'], tempDir)

    const context = await resolveLocalGitContext(skillDir)

    expect(context).not.toBeNull()
    expect(context!.gitRoot).toBe(tempDir)
    expect(context!.remoteUri).toBe('github.com/agentver/skills')
    expect(context!.remoteName).toBe('origin')
    expect(context!.ref).toBe('main')
    expect(context!.commit).toMatch(/^[a-f0-9]{40}$/)
    expect(context!.relativePath).toBe(join('.claude', 'skills', 'my-skill'))
    expect(context!.dirty).toBe(false)
    expect(context!.isSubmodule).toBe(false)
  })

  it('returns null remoteUri when no remote is configured', async () => {
    await initRepo(tempDir)
    await git(['commit', '--allow-empty', '-m', 'init'], tempDir)

    const context = await resolveLocalGitContext(tempDir)

    expect(context).not.toBeNull()
    expect(context!.remoteUri).toBeNull()
    expect(context!.remoteName).toBeNull()
  })

  it('marks dirty when files have uncommitted changes', async () => {
    await initRepo(tempDir)
    const skillDir = join(tempDir, 'skills')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '# Original\n')
    await git(['add', '.'], tempDir)
    await git(['commit', '-m', 'add skill'], tempDir)

    // Modify after commit
    await writeFile(join(skillDir, 'SKILL.md'), '# Modified\n')

    const context = await resolveLocalGitContext(skillDir)

    expect(context).not.toBeNull()
    expect(context!.dirty).toBe(true)
  })

  it('caches repo-level lookups across multiple paths in the same repo', async () => {
    await initRepo(tempDir)
    const skill1Dir = join(tempDir, 'skills', 'skill-1')
    const skill2Dir = join(tempDir, 'skills', 'skill-2')
    await mkdir(skill1Dir, { recursive: true })
    await mkdir(skill2Dir, { recursive: true })
    await writeFile(join(skill1Dir, 'SKILL.md'), '# Skill 1\n')
    await writeFile(join(skill2Dir, 'SKILL.md'), '# Skill 2\n')
    await git(['add', '.'], tempDir)
    await git(['commit', '-m', 'add skills'], tempDir)
    await git(['remote', 'add', 'origin', 'https://github.com/test/repo.git'], tempDir)

    const cache = createGitRepoCache()
    const ctx1 = await resolveLocalGitContext(skill1Dir, cache)
    const ctx2 = await resolveLocalGitContext(skill2Dir, cache)

    expect(ctx1!.remoteUri).toBe('github.com/test/repo')
    expect(ctx2!.remoteUri).toBe('github.com/test/repo')
    expect(ctx1!.relativePath).toBe(join('skills', 'skill-1'))
    expect(ctx2!.relativePath).toBe(join('skills', 'skill-2'))

    // Both should share the same cached repo info
    expect(cache.repos.size).toBe(1)
  })
})
