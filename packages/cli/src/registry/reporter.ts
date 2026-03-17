import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import type { GitSource } from '@agentver/shared'
import { getCredentials } from './auth.js'
import { getPlatformUrl } from './config.js'

const REPORT_TIMEOUT_MS = 5_000

function getMachineId(): string {
  return createHash('sha256').update(hostname()).digest('hex')
}

async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const creds = await getCredentials()
  if (!creds) return null

  if (creds.token) {
    return { Authorization: `Bearer ${creds.token}` }
  }

  if (creds.apiKey) {
    return { 'X-API-Key': creds.apiKey }
  }

  return null
}

export function reportInstallation(
  packageName: string,
  source: GitSource,
  agents: string[],
  commitSha: string
): void {
  const platformUrl = getPlatformUrl()
  if (!platformUrl) return

  void (async () => {
    try {
      const authHeaders = await getAuthHeaders()
      if (!authHeaders) return

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS)

      await fetch(`${platformUrl}/api/v1/installations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          packageSlug: packageName,
          source: {
            uri: source.uri,
            path: source.path,
            ref: source.ref,
            commit: commitSha,
          },
          agents,
          machineId: getMachineId(),
          modified: false,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
    } catch {
      // Silent — fire-and-forget
    }
  })()
}

export function reportRemoval(packageName: string): void {
  const platformUrl = getPlatformUrl()
  if (!platformUrl) return

  void (async () => {
    try {
      const authHeaders = await getAuthHeaders()
      if (!authHeaders) return

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS)

      await fetch(`${platformUrl}/api/v1/installations/${encodeURIComponent(packageName)}`, {
        method: 'DELETE',
        headers: authHeaders,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
    } catch {
      // Silent — fire-and-forget
    }
  })()
}
