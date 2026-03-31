import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import { readFilesFromDirectory } from '../git/fetcher.js'
import { getCredentials } from '../registry/auth.js'
import { getPlatformUrl } from '../registry/config.js'
import { resolveReadPath } from '../storage/canonical.js'
import type { Scope } from '../utils/paths.js'

const HTTP_TIMEOUT_MS = 15_000

type PlatformRequestOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
}

export async function requestPlatform<T>(
  path: string,
  options: PlatformRequestOptions = {}
): Promise<T> {
  const platformUrl = getPlatformUrl()
  if (!platformUrl) {
    throw new Error('Not connected to a platform. Run `agentver login <url>` first.')
  }

  const creds = await getCredentials()
  if (!creds?.token && !creds?.apiKey) {
    throw new Error('Not connected to a platform. Run `agentver login <url>` first.')
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'agentver-cli',
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  if (creds.token) {
    headers.Authorization = `Bearer ${creds.token}`
  } else if (creds.apiKey) {
    headers['X-API-Key'] = creds.apiKey
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)

  try {
    const response = await fetch(`${platformUrl}/api/v1${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error')
      throw new Error(`Platform returned ${response.status}: ${errorBody}`)
    }

    return (await response.json()) as T
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Platform request timed out')
    }
    throw error
  }
}

export async function readInstalledPackageFiles(
  projectRoot: string,
  packageName: string,
  agents: string[],
  scope: Scope = 'project'
): Promise<Array<{ path: string; content: string }>> {
  try {
    const readPath = resolveReadPath(projectRoot, packageName, agents, scope)
    if (readPath) {
      const files = await readFilesFromDirectory(readPath)
      return files.map((file) => ({ path: file.path, content: file.content }))
    }
  } catch {
    // Fall through to the legacy placement lookup when canonical resolution
    // is unavailable, such as in isolated test mocks.
  }

  for (const agentId of agents) {
    const placementPath = getSkillPlacementPath(agentId as AgentId, packageName, scope)
    if (!placementPath) {
      continue
    }

    const fullPath = join(projectRoot, placementPath)
    if (!existsSync(fullPath)) {
      continue
    }

    const files = await readFilesFromDirectory(fullPath)
    return files.map((file) => ({ path: file.path, content: file.content }))
  }

  return []
}
