import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import * as core from '@actions/core'
import {
  detectInstalledAgents,
  getSkillPlacementPath,
  resolveAgentId,
} from '@agentver/agent-definitions'
import type { LockfileV2, ManifestV2 } from '@agentver/shared'
import {
  lockfileAnySchema,
  manifestAnySchema,
  migrateLockfileV1ToV2,
  migrateManifestV1ToV2,
} from '@agentver/shared'
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

export class IntegrityError extends Error {
  constructor(packageName: string, expected: string, actual: string) {
    super(`Integrity check failed for ${packageName}: expected ${expected}, got ${actual}`)
    this.name = 'IntegrityError'
  }
}

// -- File I/O ----------------------------------------------------------------

export function readManifestFile(manifestPath: string): ManifestV2 {
  if (!existsSync(manifestPath)) {
    throw new ManifestNotFoundError(manifestPath)
  }

  const raw = readFileSync(manifestPath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Failed to parse manifest at ${manifestPath}: invalid JSON`)
  }

  const result = manifestAnySchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Invalid manifest at ${manifestPath}: schema validation failed`)
  }

  if (result.data.version === 1) {
    core.info('Migrating v1 manifest to v2 format')
    const migrated = migrateManifestV1ToV2(result.data)
    writeFileSync(manifestPath, JSON.stringify(migrated, null, 2), 'utf-8')
    return migrated
  }

  return result.data
}

export function readLockfileFile(lockfilePath: string): LockfileV2 | null {
  if (!existsSync(lockfilePath)) {
    return null
  }

  const raw = readFileSync(lockfilePath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = lockfileAnySchema.safeParse(parsed)
  if (!result.success) {
    return null
  }

  if (result.data.version === 1) {
    core.info('Migrating v1 lockfile to v2 format')
    const migrated = migrateLockfileV1ToV2(result.data)
    writeFileSync(lockfilePath, JSON.stringify(migrated, null, 2), 'utf-8')
    return migrated
  }

  return result.data
}

export function writeLockfileFile(lockfilePath: string, lockfile: LockfileV2): void {
  const dir = dirname(lockfilePath)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2), 'utf-8')
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

/**
 * Extract files from the download response's fileManifest.
 *
 * The fileManifest is stored as Prisma JSON — it may be:
 * - A record of { [filename]: content } (flat map)
 * - An array of { path, content } objects
 * - An empty object
 */
export function extractFilesFromManifest(
  fileManifest: Record<string, unknown> | unknown[]
): Array<{ path: string; content: string }> {
  if (Array.isArray(fileManifest)) {
    return fileManifest.filter((entry): entry is { path: string; content: string } => {
      if (typeof entry !== 'object' || entry === null) return false
      const record = entry as Record<string, unknown>
      return typeof record.path === 'string' && typeof record.content === 'string'
    })
  }

  return Object.entries(fileManifest)
    .filter(([, value]) => typeof value === 'string')
    .map(([path, content]) => ({ path, content: content as string }))
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

// -- Integrity ---------------------------------------------------------------

export function computeIntegrity(files: Array<{ path: string; content: string }>): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const combined = sorted.map((f) => `${f.path}\0${f.content}`).join('\0')
  const hash = createHash('sha256').update(combined).digest('base64')
  return `sha256-${hash}`
}

export function verifyIntegrity(
  files: Array<{ path: string; content: string }>,
  lockfileIntegrity: string | undefined,
  packageName: string
): void {
  if (!lockfileIntegrity) {
    core.debug(`No lockfile integrity for ${packageName}, skipping verification`)
    return
  }

  const actual = computeIntegrity(files)

  if (actual !== lockfileIntegrity) {
    throw new IntegrityError(packageName, lockfileIntegrity, actual)
  }
}

// -- Agent detection ---------------------------------------------------------

export function detectAgents(workingDirectory: string, specifiedAgents: string[]): string[] {
  if (specifiedAgents.length > 0) {
    return specifiedAgents
  }

  const detected = detectInstalledAgents(workingDirectory)
  return detected.map((a) => a.id)
}

// -- File placement ----------------------------------------------------------

export function placeFiles(
  files: Array<{ path: string; content: string }>,
  packageName: string,
  agents: string[],
  workingDirectory: string
): number {
  let filesWritten = 0
  const skillName = packageName.split('/').pop() ?? packageName

  for (const agentId of agents) {
    const resolvedId = resolveAgentId(agentId)

    if (!resolvedId) {
      core.warning(`Unrecognised agent ID '${agentId}', skipping.`)
      continue
    }

    const placementPath = getSkillPlacementPath(resolvedId, skillName, 'project')

    if (!placementPath) {
      core.warning(`No placement path found for agent '${agentId}', skipping.`)
      continue
    }

    const fullPath = join(workingDirectory, placementPath)

    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true })
    }

    for (const file of files) {
      const filePath = resolve(fullPath, file.path)
      const resolvedBase = resolve(fullPath)
      const rel = relative(resolvedBase, filePath)

      if (rel.startsWith('..') || isAbsolute(rel)) {
        core.warning(`Skipping file that escapes target directory: '${file.path}'`)
        continue
      }

      const fileDir = dirname(filePath)

      if (!existsSync(fileDir)) {
        mkdirSync(fileDir, { recursive: true })
      }

      writeFileSync(filePath, file.content, 'utf-8')
      filesWritten++
    }
  }

  return filesWritten
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

    const entry = resolvedData.get(result.name)
    if (!entry) continue

    if (!entry.response.gitUri || !entry.response.gitRef || !entry.response.gitCommitSha) {
      core.warning(
        `Skipping lockfile entry for ${result.name}: registry response missing git provenance.`
      )
      continue
    }

    updated.packages[result.name] = {
      source: {
        type: 'git',
        uri: entry.response.gitUri,
        path: entry.response.gitPath ?? '',
        ref: entry.response.gitRef,
        commit: entry.response.gitCommitSha,
      },
      integrity: computeIntegrity(entry.files),
      agents: result.agents,
    }
  }

  return updated
}

// -- Orchestration -----------------------------------------------------------

async function installPackageWithData(
  packageName: string,
  response: DownloadResponse,
  files: Array<{ path: string; content: string }>,
  config: InstallerConfig,
  lockfileIntegrity: string | undefined
): Promise<InstallResult> {
  try {
    if (config.verifyIntegrity) {
      verifyIntegrity(files, lockfileIntegrity, packageName)
    }

    const agents = detectAgents(config.workingDirectory, config.agents)

    if (agents.length === 0) {
      return {
        name: packageName,
        version: response.version,
        agents: [],
        fileCount: 0,
        success: false,
        error: 'No agents detected. Use the "agents" input to specify target agents.',
      }
    }

    const fileCount = placeFiles(files, packageName, agents, config.workingDirectory)

    return {
      name: packageName,
      version: response.version,
      agents,
      fileCount,
      success: true,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
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
  if (pkg.source.type === 'git') {
    const ref = pkg.source.ref
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

  for (const [packageName, packageInfo] of packageEntries) {
    const version = resolveVersionFromSource(packageInfo)
    core.info(`Resolving ${packageName}@${version}...`)

    let response: DownloadResponse
    let files: Array<{ path: string; content: string }>
    try {
      response = await resolvePackage(packageName, version, config.registryUrl, config.apiKey)
      files = extractFilesFromManifest(response.fileManifest)

      if (files.length === 0) {
        core.warning(`Package ${packageName}@${response.version} has no files in its manifest`)
        results.push({
          name: packageName,
          version: response.version,
          agents: [],
          fileCount: 0,
          success: false,
          error: 'Package has no files in its file manifest',
        })
        continue
      }

      resolvedData.set(packageName, { response, files })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      core.warning(`Failed to resolve ${packageName}@${version}: ${message}`)
      results.push({
        name: packageName,
        version,
        agents: [],
        fileCount: 0,
        success: false,
        error: message,
      })
      continue
    }

    core.info(`Installing ${packageName}@${response.version}...`)
    const lockfileIntegrity = existingLockfile?.packages[packageName]?.integrity
    const result = await installPackageWithData(
      packageName,
      response,
      files,
      config,
      lockfileIntegrity
    )
    results.push(result)

    if (result.success) {
      core.info(
        `Installed ${packageName}@${result.version} to ${result.agents.join(', ')} (${result.fileCount} files)`
      )
    } else {
      core.warning(`Failed to install ${packageName}: ${result.error}`)
    }
  }

  return { results, resolvedData }
}
