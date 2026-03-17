import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type Credentials = {
  token?: string
  apiKey?: string
}

function getCredentialsPath(): string {
  return join(homedir(), '.agentver', 'credentials.json')
}

export async function getCredentials(): Promise<Credentials | null> {
  const credPath = getCredentialsPath()

  if (!existsSync(credPath)) {
    return null
  }

  const raw = readFileSync(credPath, 'utf-8')

  try {
    return JSON.parse(raw) as Credentials
  } catch {
    return null
  }
}

export function saveCredentials(credentials: Credentials): void {
  const credPath = getCredentialsPath()
  const dir = join(homedir(), '.agentver')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(credPath, JSON.stringify(credentials, null, 2), { mode: 0o600 })
}

export function clearCredentials(): void {
  const credPath = getCredentialsPath()
  if (existsSync(credPath)) {
    writeFileSync(credPath, '{}', { mode: 0o600 })
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const creds = await getCredentials()
  return !!(creds?.token ?? creds?.apiKey)
}
