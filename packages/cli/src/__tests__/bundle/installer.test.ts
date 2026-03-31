import { AgentverError } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FetchedFile } from '../../git/types'
import type { SpinnerLike } from '../../output'
import { createLockfile, createManifest, createSharedGitSource } from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../storage/manifest', () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
}))

vi.mock('../../storage/lockfile', () => ({
  readLockfile: vi.fn(),
  writeLockfile: vi.fn(),
}))

vi.mock('../../storage/pair', () => ({
  updateManifestAndLockfile: vi.fn(),
}))

vi.mock('../../storage/integrity', () => ({
  computeSha256FromFiles: vi.fn().mockReturnValue('sha256-test'),
}))

vi.mock('../../bundle/local-install.js', () => ({
  installLocalBundleConstituent: vi.fn(),
}))

const VALID_BUNDLE_YAML = `
name: test-bundle
version: 1.0.0
description: A test bundle

includes:
  skills:
    - name: google-search
    - name: seo-audit
      version: "2.0.0"
      optional: true
  prompts:
    - name: pr-review
`

const MINIMAL_BUNDLE_YAML = `
name: minimal-bundle
version: 0.1.0
`

// ---------------------------------------------------------------------------
// Import the SUT after mocks
// ---------------------------------------------------------------------------

const { installBundleFromFiles } = await import('../../bundle/installer')
const { readManifest, writeManifest } = await import('../../storage/manifest')
const { readLockfile, writeLockfile } = await import('../../storage/lockfile')
const { updateManifestAndLockfile } = await import('../../storage/pair')
const { installLocalBundleConstituent } = await import('../../bundle/local-install.js')

function createBundleFile(yaml: string): FetchedFile {
  return {
    path: 'agentver.bundle.yaml',
    content: yaml,
    size: yaml.length,
  }
}

function createLocalSkillFiles(name: string): FetchedFile[] {
  const content = `---
name: ${name}
description: Test skill
version: 1.0.0
---

# ${name}

Instructions here.`
  return [
    {
      path: `skills/${name}/SKILL.md`,
      content,
      size: content.length,
    },
  ]
}

describe('installBundleFromFiles', () => {
  const source = createSharedGitSource()
  const spinner = createNoopSpinner()
  const mockInstallPackage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readManifest).mockReturnValue(createManifest())
    vi.mocked(readLockfile).mockReturnValue(createLockfile())
    vi.mocked(updateManifestAndLockfile).mockImplementation((projectRoot, scope, updater) => {
      const manifest = structuredClone(readManifest(projectRoot, scope))
      const lockfile = structuredClone(readLockfile(projectRoot, scope))
      const updated = updater(manifest, lockfile)
      writeManifest(projectRoot, updated.manifest, scope)
      writeLockfile(projectRoot, updated.lockfile, scope)
      return updated
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws when agentver.bundle.yaml is missing', async () => {
    const files: FetchedFile[] = [{ path: 'README.md', content: 'hello', size: 5 }]

    await expect(
      installBundleFromFiles(
        'test-bundle',
        files,
        ['claude-code'],
        { global: true },
        spinner as SpinnerLike,
        source,
        mockInstallPackage
      )
    ).rejects.toThrow('Bundle is missing agentver.bundle.yaml')
  })

  it('throws on invalid YAML', async () => {
    const files: FetchedFile[] = [createBundleFile('invalid: yaml: : : broken')]

    await expect(
      installBundleFromFiles(
        'test-bundle',
        files,
        ['claude-code'],
        { global: true },
        spinner as SpinnerLike,
        source,
        mockInstallPackage
      )
    ).rejects.toThrow('Failed to parse agentver.bundle.yaml')
  })

  it('throws on schema-invalid manifest', async () => {
    const files: FetchedFile[] = [createBundleFile('name: INVALID_NAME!!!\nversion: not-semver')]

    await expect(
      installBundleFromFiles(
        'test-bundle',
        files,
        ['claude-code'],
        { global: true },
        spinner as SpinnerLike,
        source,
        mockInstallPackage
      )
    ).rejects.toThrow('Invalid agentver.bundle.yaml')
  })

  it('installs a minimal bundle with no packages', async () => {
    const files = [createBundleFile(MINIMAL_BUNDLE_YAML)]

    const result = await installBundleFromFiles(
      'minimal-bundle',
      files,
      ['claude-code'],
      { global: true },
      spinner as SpinnerLike,
      source,
      mockInstallPackage
    )

    expect(result.bundleName).toBe('minimal-bundle')
    expect(result.bundleVersion).toBe('0.1.0')
    expect(result.installed).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('installs local skill files found within the bundle', async () => {
    const bundleFile = createBundleFile(VALID_BUNDLE_YAML)
    const localSkillFiles = createLocalSkillFiles('google-search')
    const files = [bundleFile, ...localSkillFiles]

    // seo-audit and pr-review are not found locally — resolve via platform
    mockInstallPackage.mockResolvedValue({
      name: 'seo-audit',
      ref: 'main',
      commitSha: 'abc1234',
      agents: ['claude-code'],
    })

    // pr-review also resolved via platform
    mockInstallPackage.mockResolvedValueOnce({
      name: 'seo-audit',
      ref: 'main',
      commitSha: 'abc1234',
      agents: ['claude-code'],
    })
    mockInstallPackage.mockResolvedValueOnce({
      name: 'pr-review',
      ref: 'main',
      commitSha: 'def5678',
      agents: ['claude-code'],
    })

    const result = await installBundleFromFiles(
      'test-bundle',
      files,
      ['claude-code'],
      { global: true },
      spinner as SpinnerLike,
      source,
      mockInstallPackage
    )

    expect(result.bundleName).toBe('test-bundle')
    expect(result.installed).toHaveLength(3)

    // google-search installed locally
    expect(result.installed[0]).toEqual({
      name: 'google-search',
      type: 'skill',
      source: { type: 'local' },
    })

    // Local install function was called
    expect(installLocalBundleConstituent).toHaveBeenCalledOnce()

    // seo-audit and pr-review resolved via platform
    expect(mockInstallPackage).toHaveBeenCalledTimes(2)
    expect(mockInstallPackage).toHaveBeenCalledWith(
      'seo-audit@2.0.0',
      expect.objectContaining({ skipAudit: true })
    )
    expect(mockInstallPackage).toHaveBeenCalledWith(
      'pr-review',
      expect.objectContaining({ skipAudit: true })
    )
  })

  it('skips optional packages that fail resolution', async () => {
    const bundleYaml = `
name: partial-bundle
version: 1.0.0
includes:
  skills:
    - name: required-skill
    - name: optional-skill
      optional: true
`
    const files = [createBundleFile(bundleYaml)]

    // required-skill succeeds
    mockInstallPackage.mockResolvedValueOnce({
      name: 'required-skill',
      ref: 'main',
      commitSha: 'abc',
      agents: ['claude-code'],
    })

    // optional-skill fails
    mockInstallPackage.mockRejectedValueOnce(new AgentverError('NOT_FOUND', 'Package not found'))

    const result = await installBundleFromFiles(
      'partial-bundle',
      files,
      ['claude-code'],
      { global: true },
      spinner as SpinnerLike,
      source,
      mockInstallPackage
    )

    expect(result.installed).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.name).toBe('optional-skill')
    expect(result.skipped[0]!.reason).toContain('Optional package failed')
  })

  it('throws when a required package fails resolution', async () => {
    const bundleYaml = `
name: strict-bundle
version: 1.0.0
includes:
  skills:
    - name: required-skill
`
    const files = [createBundleFile(bundleYaml)]

    mockInstallPackage.mockRejectedValueOnce(new AgentverError('NOT_FOUND', 'Package not found'))

    await expect(
      installBundleFromFiles(
        'strict-bundle',
        files,
        ['claude-code'],
        { global: true },
        spinner as SpinnerLike,
        source,
        mockInstallPackage
      )
    ).rejects.toThrow('Package not found')
  })

  it('handles dry-run mode without writing files', async () => {
    const files = [createBundleFile(VALID_BUNDLE_YAML), ...createLocalSkillFiles('google-search')]

    mockInstallPackage.mockResolvedValueOnce({
      name: 'seo-audit',
      ref: 'main',
      commitSha: 'abc',
      agents: ['claude-code'],
    })
    mockInstallPackage.mockResolvedValueOnce({
      name: 'pr-review',
      ref: 'main',
      commitSha: 'def',
      agents: ['claude-code'],
    })

    const result = await installBundleFromFiles(
      'test-bundle',
      files,
      ['claude-code'],
      { global: true, dryRun: true },
      spinner as SpinnerLike,
      source,
      mockInstallPackage
    )

    expect(result.installed).toHaveLength(3)
    // In dry-run, local install should not be called, and manifest should not be written
    expect(installLocalBundleConstituent).not.toHaveBeenCalled()
    expect(writeManifest).not.toHaveBeenCalled()
    expect(writeLockfile).not.toHaveBeenCalled()
  })

  it('reports MCP servers as unconfigured', async () => {
    const bundleYaml = `
name: mcp-bundle
version: 1.0.0
mcpServers:
  - name: test-server
    description: A test server
    transport: stdio
    command: npx
    args:
      - "@test/server"
`
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const files = [createBundleFile(bundleYaml)]

    const result = await installBundleFromFiles(
      'mcp-bundle',
      files,
      ['claude-code'],
      { global: true },
      spinner as SpinnerLike,
      source,
      mockInstallPackage
    )

    expect(result.mcpServers).toHaveLength(1)
    expect(result.mcpServers[0]).toEqual({ name: 'test-server', configured: false })

    consoleSpy.mockRestore()
  })
})
