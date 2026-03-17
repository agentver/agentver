import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ScanSeverity } from '../security/types.js'
import { getCredentials } from './auth.js'

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

const CONFIG_DIR = join(homedir(), '.agentver')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function readConfig(): AgentverConfig {
  if (!existsSync(CONFIG_PATH)) {
    return {}
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    return JSON.parse(raw) as AgentverConfig
  } catch {
    return {}
  }
}

export function writeConfig(config: AgentverConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
}

export function getPlatformUrl(): string | null {
  return readConfig().platformUrl ?? null
}

export async function isConnected(): Promise<boolean> {
  const url = getPlatformUrl()
  if (!url) return false

  const creds = await getCredentials()
  return !!(creds?.token ?? creds?.apiKey)
}
