/**
 * Git module mock helpers for the Agentver CLI test suite.
 *
 * These export factory functions that tests call inside beforeEach/it blocks
 * AFTER their own vi.mock() declarations. They configure the mock return
 * values and expose the mock references for assertions.
 *
 * IMPORTANT: The test file must declare vi.mock() at module level for the
 * modules it wants to mock. These helpers only configure the already-mocked
 * functions — they do NOT call vi.mock() themselves.
 *
 * Example usage in a test file:
 *
 *   vi.mock('../../git/resolver.js', () => ({
 *     parseGitSource: vi.fn(),
 *     resolveRef: vi.fn(),
 *   }))
 *
 *   vi.mock('../../git/fetcher.js', () => ({
 *     fetchFiles: vi.fn(),
 *     buildRepoUrl: vi.fn(),
 *     execGit: vi.fn(),
 *   }))
 *
 *   // Then inside beforeEach or individual tests:
 *   const gitMocks = await setupGitMocks()
 *   mockResolveRef(gitMocks, { source: mySource, commitSha: 'abc123' })
 */

import { vi } from 'vitest'
import type { FetchedFile, GitSource, ResolvedRef } from '../../git/types'
import { createFetchedFiles, createGitSource } from './fixtures'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GitMockRefs = {
  parseGitSource: ReturnType<typeof vi.fn>
  resolveRef: ReturnType<typeof vi.fn>
  fetchFiles: ReturnType<typeof vi.fn>
  buildRepoUrl: ReturnType<typeof vi.fn>
  execGit: ReturnType<typeof vi.fn>
}

// ---------------------------------------------------------------------------
// Setup — imports the already-mocked modules and returns mock references
// ---------------------------------------------------------------------------

/**
 * Imports the mocked git modules and returns references to each mock function.
 * Must be called AFTER vi.mock() declarations at module level.
 */
export async function setupGitMocks(): Promise<GitMockRefs> {
  const resolverModule = await import('../../git/resolver')
  const fetcherModule = await import('../../git/fetcher')

  return {
    parseGitSource: vi.mocked(resolverModule.parseGitSource),
    resolveRef: vi.mocked(resolverModule.resolveRef),
    fetchFiles: vi.mocked(fetcherModule.fetchFiles),
    buildRepoUrl: vi.mocked(fetcherModule.buildRepoUrl),
    execGit: vi.mocked(fetcherModule.execGit),
  }
}

// ---------------------------------------------------------------------------
// Mock configuration helpers
// ---------------------------------------------------------------------------

/**
 * Configures parseGitSource to return a resolved GitSource or throw.
 */
export function mockParseGitSource(
  mocks: GitMockRefs,
  result: GitSource | Error = createGitSource()
): void {
  if (result instanceof Error) {
    mocks.parseGitSource.mockImplementation(() => {
      throw result
    })
  } else {
    mocks.parseGitSource.mockReturnValue(result)
  }
}

/**
 * Configures resolveRef to return a ResolvedRef or reject with an error.
 */
export function mockResolveRef(mocks: GitMockRefs, result?: ResolvedRef | Error): void {
  const defaultResult: ResolvedRef = {
    source: createGitSource(),
    commitSha: 'abc1234567890abcdef1234567890abcdef1234567',
  }

  if (result instanceof Error) {
    mocks.resolveRef.mockRejectedValue(result)
  } else {
    mocks.resolveRef.mockResolvedValue(result ?? defaultResult)
  }
}

/**
 * Configures fetchFiles to return FetchedFile[] or reject with an error.
 */
export function mockFetchFiles(mocks: GitMockRefs, result?: FetchedFile[] | Error): void {
  if (result instanceof Error) {
    mocks.fetchFiles.mockRejectedValue(result)
  } else {
    const files = result ?? createFetchedFiles()
    mocks.fetchFiles.mockResolvedValue({
      files,
      commitSha: 'abc1234567890abcdef1234567890abcdef1234567',
      source: createGitSource(),
    })
  }
}

/**
 * Configures buildRepoUrl to return a URL string.
 */
export function mockBuildRepoUrl(mocks: GitMockRefs, result?: string): void {
  mocks.buildRepoUrl.mockReturnValue(result ?? 'https://github.com/test-org/test-repo.git')
}

/**
 * Configures execGit to return stdout output or reject with an error.
 */
export function mockExecGit(mocks: GitMockRefs, result?: string | Error): void {
  if (result instanceof Error) {
    mocks.execGit.mockRejectedValue(result)
  } else {
    mocks.execGit.mockResolvedValue(result ?? '')
  }
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Resets all git mock functions to their default (unconfigured) state.
 */
export function resetGitMocks(mocks: GitMockRefs): void {
  mocks.parseGitSource.mockReset()
  mocks.resolveRef.mockReset()
  mocks.fetchFiles.mockReset()
  mocks.buildRepoUrl.mockReset()
  mocks.execGit.mockReset()
}
