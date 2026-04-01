import { execFile } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { createCliLogger } from '../utils.js'

const logger = createCliLogger('git:local-context')

const execFileAsync = promisify(execFile)

const LOCAL_GIT_TIMEOUT_MS = 5_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Git context resolved from a local file path.
 * Contains everything needed to build a portable GitSource or LocalSource.
 */
export type LocalGitContext = {
  /** Absolute path to the git repository root */
  gitRoot: string
  /** Normalised remote URI: 'github.com/owner/repo' or null if no remote */
  remoteUri: string | null
  /** Name of the remote used (e.g. 'origin', 'upstream') */
  remoteName: string | null
  /** Current branch name, or 'HEAD' if detached */
  ref: string
  /** Full commit SHA of HEAD */
  commit: string
  /** Path of the skill relative to the git root */
  relativePath: string
  /** Whether the skill files have uncommitted changes */
  dirty: boolean
  /** Whether this file is inside a git submodule */
  isSubmodule: boolean
}

/**
 * In-memory cache to avoid repeated git shell calls when multiple skills
 * live in the same repository. One instance per adopt invocation.
 */
export type GitRepoCache = {
  /** Maps directory path to git root (or null if not in a repo) */
  roots: Map<string, string | null>
  /** Maps git root to resolved repo-level context */
  repos: Map<
    string,
    {
      remoteUri: string | null
      remoteName: string | null
      ref: string
      commit: string
    }
  >
}

export function createGitRepoCache(): GitRepoCache {
  return { roots: new Map(), repos: new Map() }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Resolves the full local git context for a file path.
 * Returns null if the file is not inside a git repository.
 *
 * Results are cached per git root to avoid redundant shell calls.
 */
export async function resolveLocalGitContext(
  filePath: string,
  cache?: GitRepoCache,
  preferredRemote?: string
): Promise<LocalGitContext | null> {
  const effectiveCache = cache ?? createGitRepoCache()

  const gitRoot = await findGitRoot(filePath, effectiveCache)
  if (!gitRoot) {
    return null
  }

  // Check repo-level cache
  let repoInfo = effectiveCache.repos.get(gitRoot)
  if (!repoInfo) {
    const [remoteResult, ref, commit] = await Promise.all([
      getRemoteUri(gitRoot, preferredRemote),
      getCurrentRef(gitRoot),
      getHeadCommit(gitRoot),
    ])

    repoInfo = {
      remoteUri: remoteResult.uri,
      remoteName: remoteResult.remoteName,
      ref,
      commit,
    }

    effectiveCache.repos.set(gitRoot, repoInfo)
  }

  const relativePath = relative(gitRoot, filePath)
  const dirty = await isPathDirty(gitRoot, relativePath)
  const isSubmodule = await isSubmodulePath(gitRoot)

  return {
    gitRoot,
    remoteUri: repoInfo.remoteUri,
    remoteName: repoInfo.remoteName,
    ref: repoInfo.ref,
    commit: repoInfo.commit,
    relativePath,
    dirty,
    isSubmodule,
  }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Finds the git repository root for a given path.
 * Returns null if not inside a git repo.
 */
export async function findGitRoot(dirPath: string, cache?: GitRepoCache): Promise<string | null> {
  if (cache?.roots.has(dirPath)) {
    return cache.roots.get(dirPath) ?? null
  }

  try {
    const output = await execGitLocal(['rev-parse', '--show-toplevel'], dirPath)
    const root = output.trim()
    cache?.roots.set(dirPath, root)
    return root
  } catch {
    cache?.roots.set(dirPath, null)
    return null
  }
}

/**
 * Gets the best remote URL for the repository and normalises it.
 *
 * Priority: origin > upstream > first alphabetical remote.
 * Returns null if no remotes are configured.
 */
export async function getRemoteUri(
  gitRoot: string,
  preferredRemote?: string
): Promise<{ uri: string | null; remoteName: string | null }> {
  try {
    const output = await execGitLocal(['remote'], gitRoot)
    const remotes = output.trim().split('\n').filter(Boolean)

    if (remotes.length === 0) {
      return { uri: null, remoteName: null }
    }

    let preferred: string

    if (preferredRemote && remotes.includes(preferredRemote)) {
      preferred = preferredRemote
    } else {
      preferred = remotes.includes('origin')
        ? 'origin'
        : remotes.includes('upstream')
          ? 'upstream'
          : remotes.sort()[0]!
    }

    if (preferred !== 'origin') {
      logger.debug(`Using remote "${preferred}" for ${gitRoot} (no "origin" configured)`)
    }

    const rawUrl = await execGitLocal(['remote', 'get-url', preferred], gitRoot)
    const uri = normaliseRemoteUrl(rawUrl.trim())

    return { uri, remoteName: preferred }
  } catch {
    return { uri: null, remoteName: null }
  }
}

/**
 * Normalises a raw git remote URL (SSH or HTTPS) to 'host/owner/repo'.
 *
 * Handles:
 *   git@github.com:owner/repo.git       -> github.com/owner/repo
 *   https://github.com/owner/repo.git   -> github.com/owner/repo
 *   ssh://git@github.com/owner/repo.git -> github.com/owner/repo
 *   git://github.com/owner/repo.git     -> github.com/owner/repo
 *   https://gitlab.com/group/sub/repo   -> gitlab.com/group/sub/repo
 *   ssh://git@git.company.com:2222/o/r  -> git.company.com/o/r
 *
 * Returns null if the URL cannot be parsed into a meaningful host/owner/repo.
 */
export function normaliseRemoteUrl(rawUrl: string): string | null {
  let url = rawUrl.trim()

  if (!url) {
    return null
  }

  // Handle SSH colon syntax: git@host:path -> ssh://git@host/path
  // Must match: optional-user@host:path (where path doesn't start with //)
  const sshColonMatch = /^[\w.-]+@([\w.-]+):(?!\/\/)(.+)$/.exec(url)
  if (sshColonMatch) {
    url = `ssh://${url.replace(':', '/')}`
  }

  // Try to parse as a URL
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Local path or unparseable
    return null
  }

  const host = parsed.hostname
  if (!host) {
    return null
  }

  // Extract path and clean up
  let path = parsed.pathname
  // Strip leading slash
  path = path.replace(/^\/+/, '')
  // Strip .git suffix
  path = path.replace(/\.git$/i, '')
  // Strip trailing slash
  path = path.replace(/\/+$/, '')

  // Path must have at least 2 segments (owner/repo)
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 2) {
    return null
  }

  return `${host}/${segments.join('/')}`
}

/**
 * Gets the current branch name. Returns 'HEAD' if in detached HEAD state.
 */
export async function getCurrentRef(gitRoot: string): Promise<string> {
  try {
    const output = await execGitLocal(['symbolic-ref', '--short', 'HEAD'], gitRoot)
    return output.trim()
  } catch {
    // Detached HEAD — try to find a tag
    try {
      const tag = await execGitLocal(['describe', '--tags', '--exact-match', 'HEAD'], gitRoot)
      if (tag.trim()) {
        return tag.trim()
      }
    } catch {
      // Not at a tag
    }

    return 'HEAD'
  }
}

/**
 * Gets the current HEAD commit SHA (full 40-char).
 */
export async function getHeadCommit(gitRoot: string): Promise<string> {
  const output = await execGitLocal(['rev-parse', 'HEAD'], gitRoot)
  return output.trim()
}

/**
 * Checks whether files at a given relative path have uncommitted changes.
 * Includes staged, unstaged, and untracked files.
 */
export async function isPathDirty(gitRoot: string, relativePath: string): Promise<boolean> {
  try {
    const output = await execGitLocal(['status', '--porcelain', '--', relativePath], gitRoot)
    return output.trim().length > 0
  } catch {
    // If git status fails, assume clean
    return false
  }
}

/**
 * Detects whether a path is inside a git submodule.
 * A submodule's .git is a file (gitlink) rather than a directory.
 */
export async function isSubmodulePath(gitRoot: string): Promise<boolean> {
  const gitPath = join(gitRoot, '.git')
  try {
    const stats = lstatSync(gitPath)
    return stats.isFile()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Executes a local git command with a short timeout.
 * Distinct from the remote-focused execGit in fetcher.ts.
 */
async function execGitLocal(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: LOCAL_GIT_TIMEOUT_MS,
    maxBuffer: 1 * 1024 * 1024,
  })
  return stdout
}
