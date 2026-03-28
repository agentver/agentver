/**
 * Pure data factories for the GitHub Action test suite.
 * No mocking, no side effects — returns typed objects that match real schemas.
 */

import type { Lockfile, Manifest } from '@agentver/shared'
import type { DownloadResponse, InstallerConfig } from '../../installer'
import type { InstallResult, InstallSummary } from '../../reporter'

export function createManifest(
  overrides?: Partial<Manifest> & { packages?: Manifest['packages'] }
): Manifest {
  return {
    version: 1,
    packages: {},
    ...overrides,
  }
}

export function createLockfile(
  overrides?: Partial<Lockfile> & { packages?: Lockfile['packages'] }
): Lockfile {
  return {
    version: 1,
    packages: {},
    ...overrides,
  }
}

export function createInstallerConfig(overrides?: Partial<InstallerConfig>): InstallerConfig {
  return {
    registryUrl: 'https://test.registry.com/api/v1',
    apiKey: 'test-api-key',
    workingDirectory: '/test/project',
    verifyIntegrity: true,
    agents: [],
    ...overrides,
  }
}

export function createDownloadResponse(overrides?: Partial<DownloadResponse>): DownloadResponse {
  return {
    version: '1.0.0',
    content: null,
    fileManifest: { 'SKILL.md': '# Test Skill\n\nA test skill.' },
    sha256: 'abc123def456',
    size: 42,
    gitRef: null,
    gitCommitSha: null,
    gitUri: null,
    gitPath: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export function createInstallResult(overrides?: Partial<InstallResult>): InstallResult {
  return {
    name: 'test-org/test-skill',
    version: '1.0.0',
    agents: ['claude-code'],
    fileCount: 1,
    success: true,
    ...overrides,
  }
}

export function createInstallSummary(overrides?: Partial<InstallSummary>): InstallSummary {
  return {
    results: [],
    totalInstalled: 0,
    totalFailed: 0,
    allAgents: [],
    ...overrides,
  }
}
