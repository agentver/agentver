import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as core from '@actions/core'
import { detectInstalledAgents } from '@agentver/agent-definitions'
import { executeInstall, type InstallRequest, planInstall } from '@agentver/installer'
import type { LockfileV2, ManifestV2, PackageSource } from '@agentver/shared'
import {
  createPackageKey,
  extractFilesFromManifest,
  getPackageDisplayName,
  getPackageSourceReference,
  STORAGE_SCHEMA_VERSION,
} from '@agentver/shared'
import {
  computeIntegrity,
  getManifestPath,
  IntegrityError,
  readLockfile,
  readManifest,
  StorageCorruptionError,
  verifyIntegrity,
  writeLockfile,
} from '@agentver/storage'
import type { InstallResult } from './reporter'

const REQUEST_TIMEOUT_MS = 30_000

/**
 * Response shape from GET /skills/{org}/{name}/{version}/download
 * Matches the actual API endpoint in apps/dashboard.
 */
type DownloadResponse = {
  version: string
  content: string | null
  fileManifest: Record<string, unknown> | Array<{ path: string; content: string }>
  sha256: string | null
  size: number | null
  gitRef: string | null
  gitCommitSha: string | null
  gitUri: string | null
  gitPath: string | null
  createdAt: string
}

type VersionListResponse = {
  versions: Array<{
    version: string
    changelog: string | null
    status: string
    sha256: string | null
    size: number | null
    gitRef: string | null
    gitCommitSha: string | null
    createdAt: string
  }>
}

type InstallerConfig = {
  registryUrl: string
  apiKey: string
  workingDirectory: string
  verifyIntegrity: boolean
  agents: string[]
}

export type { DownloadResponse, InstallerConfig }
export { IntegrityError }

type LegacyManifest = {
  version: 1
  packages: Record<
    string,
    {
      name?: string
      agents?: string[]
      installedAt?: string
      modified?: boolean
      path?: string
    }
  >
}

// -- Errors ------------------------------------------------------------------

export class ManifestNotFoundError extends Error {
  constructor(path: string) {
    super(
      `Manifest not found at ${path}. Run 'agentver install <package>' first or create .agentver/manifest.json`
    )
    this.name = 'ManifestNotFoundError'
  }
}

export class RegistryAuthError extends Error {
  constructor(statusCode: number, body: string) {
    super(`Authentication failed (${statusCode}): check your AGENTVER_API_KEY. ${body}`)
    this.name = 'RegistryAuthError'
  }
}

export class RegistryNetworkError extends Error {
  constructor(url: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause)
    super(`Network error fetching ${url}: ${message}`)
    this.name = 'RegistryNetworkError'
  }
}

export class RegistryTimeoutError extends Error {
  constructor(url: string) {
    super(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`)
    this.name = 'RegistryTimeoutError'
  }
}

// -- File I/O (delegated to @agentver/storage) --------------------------------

export function readManifestFile(projectRoot: string): ManifestV2 {
  const manifestPath = getManifestPath(projectRoot, 'project')

  if (!existsSync(manifestPath)) {
    throw new ManifestNotFoundError(manifestPath)
  }

  try {
    const { data, droppedEntries } = readManifest(projectRoot, 'project', {
      onWarning: (msg) => core.warning(msg),
    })

    for (const entry of droppedEntries) {
      core.warning(`Dropped manifest entry "${entry.key}": ${entry.reason}`)
    }

    return data
  } catch (error) {
    if (error instanceof StorageCorruptionError) {
      if (error.reason === 'invalid-json') {
        throw new Error(`Failed to parse manifest at ${manifestPath}: invalid JSON`)
      }
      const migrated = tryReadLegacyManifest(manifestPath)
      if (migrated) {
        core.warning(`Migrated legacy manifest at ${manifestPath} in memory`)
        return migrated
      }
      throw new Error(`Invalid manifest at ${manifestPath}: schema validation failed`)
    }
    throw error
  }
}

export function readLockfileFile(projectRoot: string): LockfileV2 | null {
  const lockfilePath = resolve(projectRoot, '.agentver', 'lockfile.json')

  if (!existsSync(lockfilePath)) {
    return null
  }

  try {
    const { data, droppedEntries } = readLockfile(projectRoot, 'project', {
      onWarning: (msg) => core.warning(msg),
    })

    for (const entry of droppedEntries) {
      core.warning(`Dropped lockfile entry "${entry.key}": ${entry.reason}`)
    }

    return data
  } catch {
    return null
  }
}

export function writeLockfileFile(projectRoot: string, lockfile: LockfileV2): void {
  writeLockfile(projectRoot, lockfile, 'project', { mode: 'none' })
}

function tryReadLegacyManifest(manifestPath: string): ManifestV2 | null {
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as LegacyManifest
    if (raw.version !== 1 || typeof raw.packages !== 'object' || raw.packages === null) {
      return null
    }

    const packages: ManifestV2['packages'] = {}
    for (const [legacyKey, legacyPkg] of Object.entries(raw.packages)) {
      const displayName = legacyPkg.name?.trim() || legacyKey
      const source: PackageSource = legacyPkg.path
        ? { type: 'local', path: legacyPkg.path }
        : {
            type: 'unknown',
            path: legacyPkg.name ?? legacyKey,
            reason: 'Migrated from legacy manifest',
          }

      const packageKey = createPackageKey(displayName, source)
      packages[packageKey] = {
        name: displayName,
        source,
        agents: legacyPkg.agents ?? [],
        installedAt: legacyPkg.installedAt ?? new Date(0).toISOString(),
        modified: legacyPkg.modified ?? false,
        ...(legacyPkg.path ? { path: legacyPkg.path } : {}),
      }
    }

    return { version: STORAGE_SCHEMA_VERSION, packages }
  } catch {
    return null
  }
}

// -- Registry ----------------------------------------------------------------

async function registryFetch<T>(path: string, registryUrl: string, apiKey: string): Promise<T> {
  const url = `${registryUrl}${path}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-Key': apiKey,
      },
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new RegistryTimeoutError(url)
    }
    throw new RegistryNetworkError(url, error)
  } finally {
    clearTimeout(timeoutId)
  }

  if (response.status === 401 || response.status === 403) {
    const body = await response.text().catch(() => 'Unknown error')
    throw new RegistryAuthError(response.status, body)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => 'Unknown error')
    throw new Error(`Registry error (${response.status}) for ${url}: ${body}`)
  }

  return response.json() as Promise<T>
}

function splitPackageName(name: string): { org: string; pkg: string } {
  const parts = name.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid package name "${name}": expected "org/name" format`)
  }
  return { org: parts[0], pkg: parts[1] }
}

function assertDownloadResponse(data: unknown): asserts data is DownloadResponse {
  const record = data as Record<string, unknown>
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof record.version !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.fileManifest !== 'object' ||
    record.fileManifest === null
  ) {
    throw new Error(
      'Invalid response from registry: missing required fields (version, createdAt, fileManifest)'
    )
  }
}

async function resolveLatestVersion(
  org: string,
  name: string,
  registryUrl: string,
  apiKey: string
): Promise<string> {
  const data = await registryFetch<VersionListResponse>(
    `/skills/${encodeURIComponent(org)}/${encodeURIComponent(name)}/versions`,
    registryUrl,
    apiKey
  )

  const available = data.versions.filter((v) => v.status !== 'YANKED')
  if (available.length === 0) {
    throw new Error(`No published versions found for ${org}/${name}`)
  }

  return available[0]!.version
}

export async function resolvePackage(
  name: string,
  version: string,
  registryUrl: string,
  apiKey: string
): Promise<DownloadResponse> {
  const { org, pkg } = splitPackageName(name)

  const resolvedVersion =
    !version || version === 'latest'
      ? await resolveLatestVersion(org, pkg, registryUrl, apiKey)
      : version

  const data = await registryFetch<unknown>(
    `/skills/${encodeURIComponent(org)}/${encodeURIComponent(pkg)}/${encodeURIComponent(resolvedVersion)}/download`,
    registryUrl,
    apiKey
  )
  assertDownloadResponse(data)
  return data
}

// -- Integrity (re-exported from @agentver/storage) --------------------------

export { computeIntegrity }

export function verifyIntegrityWithWarning(
  files: Array<{ path: string; content: string }>,
  lockfileIntegrity: string | undefined,
  packageName: string
): void {
  if (!lockfileIntegrity) {
    core.debug(`No lockfile integrity for ${packageName}, skipping verification`)
    return
  }

  verifyIntegrity(files, lockfileIntegrity, packageName)
}

// -- Agent detection ---------------------------------------------------------

export function detectAgents(workingDirectory: string, specifiedAgents: string[]): string[] {
  if (specifiedAgents.length > 0) {
    return specifiedAgents
  }

  const detected = detectInstalledAgents(workingDirectory)
  return detected.map((a) => a.id)
}

// -- Lockfile update ---------------------------------------------------------

export function updateLockfile(
  lockfile: LockfileV2,
  results: InstallResult[],
  resolvedData: Map<
    string,
    { response: DownloadResponse; files: Array<{ path: string; content: string }> }
  >
): LockfileV2 {
  const updated: LockfileV2 = { ...lockfile, packages: { ...lockfile.packages } }

  for (const result of results) {
    if (!result.success) continue
    if (!result.packageKey) continue

    const entry = resolvedData.get(result.packageKey)
    if (!entry) continue

    if (!entry.response.gitUri || !entry.response.gitRef || !entry.response.gitCommitSha) {
      core.warning(
        `Skipping lockfile entry for ${result.name}: registry response missing git provenance.`
      )
      continue
    }

    const source = {
      type: 'git' as const,
      uri: entry.response.gitUri,
      path: entry.response.gitPath ?? '',
      ref: entry.response.gitRef,
      commit: entry.response.gitCommitSha,
    }

    updated.packages[createPackageKey(result.name, source)] = {
      name: result.name,
      source,
      integrity: computeIntegrity(entry.files),
      agents: result.agents,
    }
  }

  return updated
}

// -- Source building ---------------------------------------------------------

function buildSourceFromResponse(response: DownloadResponse): PackageSource {
  if (response.gitUri && response.gitRef && response.gitCommitSha) {
    return {
      type: 'git',
      uri: response.gitUri,
      path: response.gitPath ?? '',
      ref: response.gitRef,
      commit: response.gitCommitSha,
    }
  }

  return {
    type: 'unknown',
    path: '',
    ref: response.gitRef ?? undefined,
    commit: response.gitCommitSha ?? undefined,
  }
}

// -- Orchestration -----------------------------------------------------------

function installPackageWithData(
  packageName: string,
  response: DownloadResponse,
  files: Array<{ path: string; content: string }>,
  config: InstallerConfig,
  lockfileIntegrity: string | undefined
): InstallResult {
  try {
    if (config.verifyIntegrity) {
      verifyIntegrityWithWarning(files, lockfileIntegrity, packageName)
    }

    const agents = detectAgents(config.workingDirectory, config.agents)

    if (agents.length === 0) {
      return {
        packageKey: packageName,
        name: packageName,
        version: response.version,
        agents: [],
        fileCount: 0,
        success: false,
        error: 'No agents detected. Use the "agents" input to specify target agents.',
      }
    }

    const source = buildSourceFromResponse(response)

    const request: InstallRequest = {
      packageKey: createPackageKey(packageName, source),
      displayName: packageName,
      packageType: 'SKILL',
      source,
      files,
      integrity: computeIntegrity(files),
      target: {
        scope: 'project',
        projectRoot: config.workingDirectory,
        agents,
      },
      policy: {
        conflictStrategy: 'force',
        preferredLinkMode: 'copy',
        allowFallback: false,
        dryRun: false,
        persist: false,
        securityScanPolicy: 'skip',
      },
    }

    const plan = planInstall(request)
    const result = executeInstall(plan)

    const installedAgents = result.placements.filter((p) => p.success).map((p) => p.agentId)

    return {
      packageKey: request.packageKey,
      name: packageName,
      version: response.version,
      agents: installedAgents.length > 0 ? installedAgents : agents,
      fileCount: result.filesPlacedCount,
      success: result.success,
      error: result.error?.message,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      packageKey: packageName,
      name: packageName,
      version: response.version,
      agents: [],
      fileCount: 0,
      success: false,
      error: message,
    }
  }
}

function resolveVersionFromSource(pkg: ManifestV2['packages'][string]): string {
  if (pkg.source.type === 'git' || pkg.source.type === 'platform') {
    const ref = getPackageSourceReference(pkg.source)
    if (ref === 'unknown') return 'latest'
    // Strip git ref prefixes to extract semver (refs/tags/v1.0.0 -> 1.0.0, v1.0.0 -> 1.0.0)
    const stripped = ref.replace(/^(refs\/tags\/)?v?/, '')
    return /^\d+\.\d+\.\d+/.test(stripped) ? stripped : 'latest'
  }
  return 'latest'
}

export async function installAllPackages(
  manifest: ManifestV2,
  config: InstallerConfig,
  existingLockfile: LockfileV2 | null
): Promise<{
  results: InstallResult[]
  resolvedData: Map<
    string,
    { response: DownloadResponse; files: Array<{ path: string; content: string }> }
  >
}> {
  const results: InstallResult[] = []
  const resolvedData = new Map<
    string,
    { response: DownloadResponse; files: Array<{ path: string; content: string }> }
  >()
  const packageEntries = Object.entries(manifest.packages)

  for (const [packageKey, packageInfo] of packageEntries) {
    const displayName = getPackageDisplayName(packageKey, packageInfo)
    const version = resolveVersionFromSource(packageInfo)
    core.info(`Resolving ${displayName}@${version}...`)

    let response: DownloadResponse
    let files: Array<{ path: string; content: string }>
    try {
      response = await resolvePackage(displayName, version, config.registryUrl, config.apiKey)
      files = extractFilesFromManifest(response.fileManifest)

      if (files.length === 0) {
        core.warning(`Package ${displayName}@${response.version} has no files in its manifest`)
        results.push({
          name: displayName,
          version: response.version,
          agents: [],
          fileCount: 0,
          success: false,
          error: 'Package has no files in its file manifest',
        })
        continue
      }

      resolvedData.set(packageKey, { response, files })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      core.warning(`Failed to resolve ${displayName}@${version}: ${message}`)
      results.push({
        name: displayName,
        version,
        agents: [],
        fileCount: 0,
        success: false,
        error: message,
      })
      continue
    }

    core.info(`Installing ${displayName}@${response.version}...`)
    const lockfileIntegrity = existingLockfile?.packages[packageKey]?.integrity
    const result = installPackageWithData(displayName, response, files, config, lockfileIntegrity)
    results.push(result)

    if (result.success) {
      core.info(
        `Installed ${displayName}@${result.version} to ${result.agents.join(', ')} (${result.fileCount} files)`
      )
    } else {
      core.warning(`Failed to install ${displayName}: ${result.error}`)
    }
  }

  return { results, resolvedData }
}
