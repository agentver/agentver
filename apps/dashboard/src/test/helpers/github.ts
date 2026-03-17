import { type Mock, vi } from 'vitest'

type MockGitHubApi = {
  getRepoContents: Mock
  commitFiles: Mock
  getDefaultBranch: Mock
  validateRepoAccess: Mock
  createBranch: Mock
}

export function mockGitHubApi(): MockGitHubApi {
  return {
    getRepoContents: vi.fn(),
    commitFiles: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue('main'),
    validateRepoAccess: vi.fn().mockResolvedValue(true),
    createBranch: vi.fn(),
  }
}
