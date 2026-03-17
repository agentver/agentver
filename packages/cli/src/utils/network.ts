import chalk from 'chalk'
import { getRegistryUrl } from '../registry/client'

const ONLINE_CHECK_TIMEOUT_MS = 3_000

export async function checkOnline(): Promise<boolean> {
  const registryUrl = getRegistryUrl()
  const healthUrl = `${registryUrl}/health`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), ONLINE_CHECK_TIMEOUT_MS)

    const response = await fetch(healthUrl, {
      method: 'HEAD',
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    return response.ok
  } catch {
    return false
  }
}

export function showOfflineError(): void {
  console.error(
    chalk.red('Unable to reach the Agentver registry.') +
      ' Please check your internet connection.\n'
  )
  console.error(
    chalk.dim(
      `If you're behind a proxy, set the HTTPS_PROXY environment variable.\n` +
        `If the registry is down, try again later.\n\n` +
        `Some commands work offline: list, info (cached packages only)`
    )
  )
}
