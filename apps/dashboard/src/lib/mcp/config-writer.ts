import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { McpConfigFormat } from '@agentver/agent-definitions'
import { createLogger } from '@agentver/shared'

const logger = createLogger('mcp:config-writer')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpServerEntry = {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export type McpConfigWriteResult = {
  agent: string
  configPath: string
  serversAdded: string[]
  serversUpdated: string[]
}

// ---------------------------------------------------------------------------
// Format-specific readers/writers
// ---------------------------------------------------------------------------

type McpServersFormat = {
  mcpServers: Record<string, McpServerEntry>
}

type VscodeServersFormat = {
  servers: Record<string, McpServerEntry & { type: string }>
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

// ---------------------------------------------------------------------------
// Core writer
// ---------------------------------------------------------------------------

/**
 * Write MCP server entries into an agent's native config file.
 *
 * This is the core function that enables "no proxy" MCP configuration —
 * servers are written directly into the agent's config format so tools
 * appear natively in the agent's context.
 */
export async function writeMcpConfig(params: {
  configPath: string
  format: McpConfigFormat
  servers: Record<string, McpServerEntry>
}): Promise<{ added: string[]; updated: string[] }> {
  const { configPath, format, servers } = params
  const added: string[] = []
  const updated: string[] = []

  switch (format) {
    case 'mcp-servers': {
      const existing = await readJsonFile<McpServersFormat>(configPath)
      const config: McpServersFormat = existing ?? { mcpServers: {} }

      if (!config.mcpServers) {
        config.mcpServers = {}
      }

      for (const [name, entry] of Object.entries(servers)) {
        if (config.mcpServers[name]) {
          updated.push(name)
        } else {
          added.push(name)
        }
        config.mcpServers[name] = entry
      }

      await writeJsonFile(configPath, config)
      break
    }

    case 'vscode-servers': {
      const existing = await readJsonFile<VscodeServersFormat>(configPath)
      const config: VscodeServersFormat = existing ?? { servers: {} }

      if (!config.servers) {
        config.servers = {}
      }

      for (const [name, entry] of Object.entries(servers)) {
        if (config.servers[name]) {
          updated.push(name)
        } else {
          added.push(name)
        }

        config.servers[name] = {
          type: entry.url ? 'sse' : 'stdio',
          ...entry,
        }
      }

      await writeJsonFile(configPath, config)
      break
    }
  }

  logger.info('MCP config written', {
    configPath,
    format,
    added,
    updated,
  })

  return { added, updated }
}

/**
 * Remove MCP server entries from an agent's native config file.
 */
export async function removeMcpConfig(params: {
  configPath: string
  format: McpConfigFormat
  serverNames: string[]
}): Promise<string[]> {
  const { configPath, format, serverNames } = params
  const removed: string[] = []

  switch (format) {
    case 'mcp-servers': {
      const config = await readJsonFile<McpServersFormat>(configPath)
      if (!config?.mcpServers) return removed

      for (const name of serverNames) {
        if (config.mcpServers[name]) {
          delete config.mcpServers[name]
          removed.push(name)
        }
      }

      await writeJsonFile(configPath, config)
      break
    }

    case 'vscode-servers': {
      const config = await readJsonFile<VscodeServersFormat>(configPath)
      if (!config?.servers) return removed

      for (const name of serverNames) {
        if (config.servers[name]) {
          delete config.servers[name]
          removed.push(name)
        }
      }

      await writeJsonFile(configPath, config)
      break
    }
  }

  logger.info('MCP config entries removed', {
    configPath,
    format,
    removed,
  })

  return removed
}

/**
 * Read existing MCP server entries from an agent's config file.
 */
export async function readMcpConfig(params: {
  configPath: string
  format: McpConfigFormat
}): Promise<Record<string, McpServerEntry>> {
  const { configPath, format } = params

  switch (format) {
    case 'mcp-servers': {
      const config = await readJsonFile<McpServersFormat>(configPath)
      return config?.mcpServers ?? {}
    }

    case 'vscode-servers': {
      const config = await readJsonFile<VscodeServersFormat>(configPath)
      if (!config?.servers) return {}

      const entries: Record<string, McpServerEntry> = {}
      for (const [name, entry] of Object.entries(config.servers)) {
        const { type: _type, ...rest } = entry
        entries[name] = rest
      }
      return entries
    }
  }
}

/**
 * Resolve credential placeholders in environment variables.
 *
 * Replaces `${credentials.<key>}` patterns with actual values
 * from the provided credentials map.
 *
 * @example
 * resolveCredentials(
 *   { GITHUB_TOKEN: '${credentials.github-pat}' },
 *   { 'github-pat': 'ghp_xxx...' }
 * )
 * // => { GITHUB_TOKEN: 'ghp_xxx...' }
 */
export function resolveCredentials(
  env: Record<string, string>,
  credentials: Record<string, string>
): Record<string, string> {
  const resolved: Record<string, string> = {}

  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(/\$\{credentials\.([a-z0-9-]+)\}/g, (_match, credKey: string) => {
      const credValue = credentials[credKey]
      if (!credValue) {
        logger.warn('Unresolved credential placeholder', { key, credKey })
        return ''
      }
      return credValue
    })
  }

  return resolved
}

/**
 * Write MCP servers for multiple agents at once.
 * Resolves absolute config paths from project root and agent definitions.
 */
export async function writeMcpConfigForAgents(params: {
  projectRoot: string
  agents: Array<{
    agentId: string
    mcpConfigPath: string
    mcpConfigFormat: McpConfigFormat
  }>
  servers: Record<string, McpServerEntry>
}): Promise<McpConfigWriteResult[]> {
  const { projectRoot, agents, servers } = params
  const results: McpConfigWriteResult[] = []

  for (const agent of agents) {
    const configPath = join(projectRoot, agent.mcpConfigPath)

    const { added, updated } = await writeMcpConfig({
      configPath,
      format: agent.mcpConfigFormat,
      servers,
    })

    results.push({
      agent: agent.agentId,
      configPath,
      serversAdded: added,
      serversUpdated: updated,
    })
  }

  return results
}
