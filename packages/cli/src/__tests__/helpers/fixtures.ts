/**
 * Pure data factories for the Agentver CLI test suite.
 * No mocking, no side effects — returns typed objects that match real schemas.
 */

import type {
  LockfileV2,
  LockfileV2Package,
  ManifestV2,
  ManifestV2Package,
  PlatformSource,
  GitSource as SharedGitSource,
  WellKnownSource,
} from '@agentver/shared'
import type { FetchedFile, GitSource } from '../../git/types'
import type { ScanFinding, ScanResult, ScanSeverity, ScanVerdict } from '../../security/types'

// ---------------------------------------------------------------------------
// Git sources (CLI-local type, has host/owner/repo rather than uri)
// ---------------------------------------------------------------------------

export function createGitSource(overrides?: Partial<GitSource>): GitSource {
  return {
    host: 'github.com',
    owner: 'test-org',
    repo: 'test-repo',
    path: 'skills/test-skill',
    ref: 'main',
    commit: undefined,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Shared-schema git source (used inside manifest/lockfile packages)
// ---------------------------------------------------------------------------

export function createSharedGitSource(overrides?: Partial<SharedGitSource>): SharedGitSource {
  return {
    type: 'git',
    uri: 'https://github.com/test-org/test-repo',
    path: 'skills/test-skill',
    ref: 'main',
    commit: 'abc1234567',
    ...overrides,
  }
}

export function createPlatformSource(overrides?: Partial<PlatformSource>): PlatformSource {
  return {
    type: 'platform',
    uri: 'agentver://test-org',
    path: 'skills/test-skill',
    ref: 'main',
    commit: 'abc1234567',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Well-known source
// ---------------------------------------------------------------------------

export function createWellKnownSource(overrides?: Partial<WellKnownSource>): WellKnownSource {
  return {
    type: 'well-known',
    baseUrl: 'https://skills.example.com',
    hostname: 'skills.example.com',
    skillName: 'test-skill',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Manifest V2
// ---------------------------------------------------------------------------

export function createManifestPackage(overrides?: Partial<ManifestV2Package>): ManifestV2Package {
  return {
    source: createSharedGitSource(),
    agents: ['claude-code'],
    installedAt: '2025-01-15T10:30:00.000Z',
    modified: false,
    ...overrides,
  }
}

export function createManifest(
  overrides?: Partial<ManifestV2> & {
    packages?: Record<string, ManifestV2Package>
  }
): ManifestV2 {
  return {
    version: 2,
    packages: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Lockfile V2
// ---------------------------------------------------------------------------

export function createLockfilePackage(overrides?: Partial<LockfileV2Package>): LockfileV2Package {
  return {
    source: createSharedGitSource(),
    integrity: 'sha256-abc123def456',
    agents: ['claude-code'],
    ...overrides,
  }
}

export function createLockfile(
  overrides?: Partial<LockfileV2> & {
    packages?: Record<string, LockfileV2Package>
  }
): LockfileV2 {
  return {
    version: 2,
    packages: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// SKILL.md content
// ---------------------------------------------------------------------------

export type SkillMdFrontmatter = {
  name?: string
  description?: string
  version?: string
  license?: string
  compatibility?: string | string[]
  metadata?: Record<string, string>
  'allowed-tools'?: string | string[]
  dependsOn?: string[]
  conflictsWith?: string[]
}

export function createSkillMd(frontmatter?: SkillMdFrontmatter): string {
  const fm: SkillMdFrontmatter = {
    name: 'test-skill',
    description: 'A test skill for unit testing',
    version: '1.0.0',
    ...frontmatter,
  }

  const lines: string[] = ['---']
  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined) continue

    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const item of value) {
        lines.push(`  - ${item}`)
      }
    } else if (typeof value === 'object') {
      lines.push(`${key}:`)
      for (const [k, v] of Object.entries(value)) {
        lines.push(`  ${k}: ${v}`)
      }
    } else {
      lines.push(`${key}: ${String(value)}`)
    }
  }
  lines.push('---')
  lines.push('')
  lines.push('# Test Skill')
  lines.push('')
  lines.push('This is a test skill used for unit testing.')
  lines.push('')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Fetched files
// ---------------------------------------------------------------------------

export function createFetchedFiles(count = 2): FetchedFile[] {
  const files: FetchedFile[] = []

  // Always include SKILL.md as the first file
  const skillContent = createSkillMd()
  files.push({
    path: 'SKILL.md',
    content: skillContent,
    size: skillContent.length,
  })

  // Add additional files up to count
  for (let i = 1; i < count; i++) {
    const content = `# Reference file ${i}\n\nAdditional reference content.\n`
    files.push({
      path: `references/ref-${i}.md`,
      content,
      size: content.length,
    })
  }

  return files
}

// ---------------------------------------------------------------------------
// Platform API response shapes
// ---------------------------------------------------------------------------

export type PlatformSearchResultItem = {
  name: string
  description: string
  type: string
  source: string
  url?: string
}

export type PlatformSearchResponse = {
  results: PlatformSearchResultItem[]
}

export function createPlatformSearchResult(
  overrides?: Partial<PlatformSearchResponse>
): PlatformSearchResponse {
  return {
    results: [
      {
        name: 'example-skill',
        description: 'An example skill from the platform',
        type: 'SKILL',
        source: 'github.com/test-org/skills',
        url: 'https://agentver.com/skills/example-skill',
      },
    ],
    ...overrides,
  }
}

export type PlatformVersionItem = {
  version: string
  ref: string
  commit: string
  publishedAt: string
}

export type PlatformVersionResponse = {
  name: string
  versions: PlatformVersionItem[]
}

export function createPlatformVersionResponse(
  overrides?: Partial<PlatformVersionResponse>
): PlatformVersionResponse {
  return {
    name: 'example-skill',
    versions: [
      {
        version: '1.0.0',
        ref: 'v1.0.0',
        commit: 'abc1234567',
        publishedAt: '2025-01-15T10:30:00.000Z',
      },
      {
        version: '0.9.0',
        ref: 'v0.9.0',
        commit: 'def7890123',
        publishedAt: '2025-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Audit / scan results
// ---------------------------------------------------------------------------

export function createScanFinding(overrides?: Partial<ScanFinding>): ScanFinding {
  return {
    severity: 'MEDIUM',
    category: 'SUSPICIOUS_URL',
    file: 'SKILL.md',
    line: 10,
    message: 'Suspicious URL detected',
    evidence: 'http://evil.example.com/payload',
    ...overrides,
  }
}

export function createAuditScanResult(
  verdict: ScanVerdict = 'PASS',
  overrides?: Partial<ScanResult>
): ScanResult {
  const findings: ScanFinding[] =
    verdict === 'PASS'
      ? []
      : verdict === 'WARN'
        ? [createScanFinding({ severity: 'MEDIUM' })]
        : [createScanFinding({ severity: 'HIGH', category: 'DANGEROUS_COMMAND' })]

  return {
    verdict,
    findings,
    scannedAt: '2025-01-15T10:30:00.000Z',
    duration: 12,
    provider: 'built-in',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Credentials and config (mirrors registry/auth.ts and registry/config.ts)
// ---------------------------------------------------------------------------

export type Credentials = {
  token?: string
  apiKey?: string
}

export type AuditConfig = {
  enabled?: boolean
  blockSeverity?: ScanSeverity
  trustedSources?: string[]
}

export type AgentverConfig = {
  platformUrl?: string
  defaultOrg?: string
  telemetry?: boolean
  audit?: AuditConfig
}

export function createCredentials(overrides?: Partial<Credentials>): Credentials {
  return {
    token: 'test-token-abc123',
    ...overrides,
  }
}

export function createConfig(overrides?: Partial<AgentverConfig>): AgentverConfig {
  return {
    platformUrl: 'https://app.agentver.com',
    ...overrides,
  }
}
