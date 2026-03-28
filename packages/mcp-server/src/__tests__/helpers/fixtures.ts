/**
 * Pure data factories for the MCP server test suite.
 * No mocking, no side effects — returns typed objects that match real schemas.
 */

import type { Lockfile, Manifest } from '@agentver/shared'

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

export function createInstalledPackage(
  overrides?: Partial<Manifest['packages'][string]>
): Manifest['packages'][string] {
  return {
    name: 'test-org/test-skill',
    version: '1.0.0',
    agents: ['claude-code'],
    installedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export function createLockedPackage(
  overrides?: Partial<Lockfile['packages'][string]>
): Lockfile['packages'][string] {
  return {
    version: '1.0.0',
    resolved: 'https://app.agentver.com/api/v1/skills/test-org/test-skill/1.0.0/download',
    integrity: 'sha256-abc123',
    agents: ['claude-code'],
    ...overrides,
  }
}

type DownloadResponse = {
  version: string
  content: string | null
  fileManifest: Record<string, unknown>
  sha256: string | null
  size: number | null
  gitRef: string | null
  gitCommitSha: string | null
  gitUri: string | null
  gitPath: string | null
  createdAt: string
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

type VersionListResponse = {
  versions: Array<{
    version: string
    status: string
  }>
}

export function createVersionListResponse(
  overrides?: Partial<VersionListResponse>
): VersionListResponse {
  return {
    versions: [
      { version: '1.0.0', status: 'PUBLISHED' },
      { version: '0.9.0', status: 'PUBLISHED' },
    ],
    ...overrides,
  }
}
