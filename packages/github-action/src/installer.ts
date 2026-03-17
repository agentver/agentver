import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import * as core from '@actions/core'
import {
  detectInstalledAgents,
  getSkillPlacementPath,
  resolveAgentId,
} from '@agentver/agent-definitions'
import type { Lockfile, Manifest } from '@agentver/shared'
import type { InstallResult } from './reporter'

type VersionResponse = {
  version: string
  downloadUrl: string
  sha256: string
  fileManifest: Array<{ path: string; content: string }>
}

type InstallerConfig = {
  registryUrl: string
  apiKey: string
  workingDirectory: string
  verifyIntegrity: boolean
  agents: string[]
}

export type { InstallerConfig, VersionResponse }

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

export class IntegrityError extends Error {
  constructor(packageName: string, expected: string, actual: string) {
    super(`Integrity check failed for ${packageName}: expected ${expected}, got ${actual}`)
    this.name = 'IntegrityError'
  }
}

// -- File I/O ----------------------------------------------------------------

export function readManifestFile(manifestPath: string): Manifest {
  if (!existsSync(manifestPath)) {
    throw new ManifestNotFoundError(manifestPath)
  }

  const raw = readFileSync(manifestPath, 'utf-8')

  try {
    return JSON.parse(raw) as Manifest
  } catch {
    throw new Error(`Failed to parse manifest at ${manifestPath}: invalid JSON`)
  }
}

export function readLockfileFile(lockfilePath: string): Lockfile | null {
  if (!existsSync(lockfilePath)) {
    return null
  }

  const raw = readFileSync(lockfilePath, 'utf-8')

  try {
    return JSON.parse(raw) as Lockfile
  } catch {
    return null
  }
}

export function writeLockfileFile(lockfilePath: string, lockfile: Lockfile): void {
  const dir = dirname(lockfilePath)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2), 'utf-8')
}

// -- Registry ----------------------------------------------------------------

async function registryFetch<T>(path: string, registryUrl: string, apiKey: string): Promise<T> {
  const url = `${registryUrl}${path}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-Key': apiKey,
      },
    })
  } catch (error) {
    throw new RegistryNetworkError(url, error)
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

function assertVersionResponse(data: unknown): asserts data is VersionResponse {
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as Record<string, unknown>).version !== 'string' ||
    typeof (data as Record<string, unknown>).sha256 !== 'string' ||
    !Array.isArray((data as Record<string, unknown>).fileManifest)
  ) {
    throw new Error(
      'Invalid response from registry: missing required fields (version, sha256, fileManifest)'
    )
  }
}

export async function resolvePackage(
  name: string,
  version: string,
  registryUrl: string,
  apiKey: string
): Promise<VersionResponse> {
  const data = await registryFetch<unknown>(
    `/skills/${encodeURIComponent(name)}/versions?version=${encodeURIComponent(version)}`,
    registryUrl,
    apiKey
  )
  assertVersionResponse(data)
  return data
}

// -- Integrity ---------------------------------------------------------------

export function verifyIntegrity(
  fileManifest: Array<{ path: string; content: string }>,
  expectedHash: string,
  packageName: string
): void {
  const sorted = [...fileManifest].sort((a, b) => a.path.localeCompare(b.path))
  const combined = sorted.map((f) => `${f.path}\0${f.content}`).join('\n')
  const hash = createHash('sha256').update(combined).digest('base64')
  const actual = `sha256-${hash}`
  const expected = `sha256-${expectedHash}`

  if (actual !== expected) {
    throw new IntegrityError(packageName, expected, actual)
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
  fileManifest: Array<{ path: string; content: string }>,
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

    for (const file of fileManifest) {
      if (file.path.includes('..')) {
        core.warning(`Skipping file with path traversal segment: '${file.path}'`)
        continue
      }

      const filePath = resolve(fullPath, file.path)
      const resolvedBase = resolve(fullPath)

      if (!filePath.startsWith(`${resolvedBase}/`) && filePath !== resolvedBase) {
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
  lockfile: Lockfile,
  results: InstallResult[],
  resolvedData: Map<string, VersionResponse>
): Lockfile {
  const updated: Lockfile = { ...lockfile, packages: { ...lockfile.packages } }

  for (const result of results) {
    if (!result.success) continue

    const data = resolvedData.get(result.name)
    if (!data) continue

    updated.packages[result.name] = {
      version: result.version,
      resolved: data.downloadUrl,
      integrity: `sha256-${data.sha256}`,
      agents: result.agents,
    }
  }

  return updated
}

// -- Orchestration -----------------------------------------------------------

async function installPackageWithData(
  packageName: string,
  data: VersionResponse,
  config: InstallerConfig
): Promise<InstallResult> {
  try {
    if (config.verifyIntegrity) {
      verifyIntegrity(data.fileManifest, data.sha256, packageName)
    }

    const agents = detectAgents(config.workingDirectory, config.agents)

    if (agents.length === 0) {
      return {
        name: packageName,
        version: data.version,
        agents: [],
        fileCount: 0,
        success: false,
        error: 'No agents detected. Use the "agents" input to specify target agents.',
      }
    }

    const fileCount = placeFiles(data.fileManifest, packageName, agents, config.workingDirectory)

    return {
      name: packageName,
      version: data.version,
      agents,
      fileCount,
      success: true,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      name: packageName,
      version: data.version,
      agents: [],
      fileCount: 0,
      success: false,
      error: message,
    }
  }
}

export async function installAllPackages(
  manifest: Manifest,
  config: InstallerConfig
): Promise<{
  results: InstallResult[]
  resolvedData: Map<string, VersionResponse>
}> {
  const results: InstallResult[] = []
  const resolvedData = new Map<string, VersionResponse>()
  const packageEntries = Object.entries(manifest.packages)

  for (const [packageName, packageInfo] of packageEntries) {
    core.info(`Resolving ${packageName}@${packageInfo.version}...`)

    let data: VersionResponse | null = null
    try {
      data = await resolvePackage(
        packageName,
        packageInfo.version,
        config.registryUrl,
        config.apiKey
      )
      resolvedData.set(packageName, data)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      core.warning(`Failed to resolve ${packageName}@${packageInfo.version}: ${message}`)
      results.push({
        name: packageName,
        version: packageInfo.version,
        agents: [],
        fileCount: 0,
        success: false,
        error: message,
      })
      continue
    }

    core.info(`Installing ${packageName}@${data.version}...`)
    const result = await installPackageWithData(packageName, data, config)
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
