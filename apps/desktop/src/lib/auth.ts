import { fetch } from '@tauri-apps/plugin-http'
import { Store } from '@tauri-apps/plugin-store'
import { DEFAULT_PLATFORM_URL } from './config'

const AUTH_STORE_KEY = 'auth'
const STORE_PATH = 'agentver-auth.json'

export type AuthData = {
  token?: string
  apiKey?: string
  user?: {
    id: string
    email: string
    name: string
  }
  platformUrl?: string
}

let storeInstance: Store | null = null

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load(STORE_PATH)
  }
  return storeInstance
}

export async function getAuthData(): Promise<AuthData | null> {
  const store = await getStore()
  return (await store.get<AuthData>(AUTH_STORE_KEY)) ?? null
}

export async function saveAuthData(data: AuthData): Promise<void> {
  const store = await getStore()
  await store.set(AUTH_STORE_KEY, data)
  await store.save()
}

export async function clearAuthData(): Promise<void> {
  const store = await getStore()
  await store.delete(AUTH_STORE_KEY)
  await store.save()
  storeInstance = null
}

export async function loginWithAPIKey(
  apiKey: string,
  platformUrl: string = DEFAULT_PLATFORM_URL
): Promise<AuthData> {
  // Validate the API key by calling the platform
  const response = await fetch(`${platformUrl}/api/v1/auth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
  })

  if (!response.ok) {
    throw new Error(
      response.status === 401 ? 'Invalid API key' : `Authentication failed (${response.status})`
    )
  }

  const data = (await response.json()) as { token: string; scopes: string[] }

  // Fetch user profile
  const meResponse = await fetch(`${platformUrl}/api/v1/me`, {
    headers: { Authorization: `Bearer ${data.token}` },
  })

  let user: AuthData['user']
  if (meResponse.ok) {
    const meData = (await meResponse.json()) as {
      id: string
      email: string
      name: string
    }
    user = { id: meData.id, email: meData.email, name: meData.name }
  }

  const authData: AuthData = {
    apiKey,
    token: data.token,
    user,
    platformUrl,
  }

  await saveAuthData(authData)

  // Also authenticate the CLI
  const { runCLI } = await import('./cli-bridge')
  const { loginResultSchema } = await import('@agentver/shared')
  await runCLI('login', ['--token', apiKey], loginResultSchema)

  return authData
}

export async function logout(): Promise<void> {
  await clearAuthData()

  // Also log out the CLI
  const { runCLI } = await import('./cli-bridge')
  const { logoutResultSchema } = await import('@agentver/shared')
  await runCLI('logout', [], logoutResultSchema)
}
