export const AGENT_IDS = [
  'adal',
  'aider',
  'amp',
  'antigravity',
  'augment',
  'claude-code',
  'claude-cowork',
  'cline',
  'codebuddy',
  'codex',
  'command-code',
  'continue',
  'copilot',
  'cortex',
  'crush',
  'cursor',
  'droid',
  'gemini-cli',
  'goose',
  'iflow-cli',
  'junie',
  'kilo',
  'kimi-cli',
  'kiro-cli',
  'kode',
  'mcpjam',
  'mistral-vibe',
  'mux',
  'neovate',
  'openclaw',
  'opencode',
  'openhands',
  'pi',
  'pochi',
  'qoder',
  'qwen-code',
  'replit',
  'roo',
  'trae',
  'trae-cn',
  'universal',
  'windsurf',
  'zencoder',
] as const

export type AgentId = (typeof AGENT_IDS)[number]

export type AgentCategory = 'universal' | 'agent-specific'

/**
 * MCP config format identifier. Determines how to write server entries.
 * - 'mcp-servers' — `{ "mcpServers": { "<name>": { "command": "...", "args": [...], "env": {...} } } }`
 * - 'vscode-servers' — `{ "servers": { "<name>": { "type": "stdio", "command": "...", "args": [...], "env": {...} } } }`
 */
export type McpConfigFormat = 'mcp-servers' | 'vscode-servers'

export type AgentDefinition = {
  id: AgentId
  name: string
  projectSkillPath: string
  globalSkillPath: string
  configFiles: string[]
  configDirs: string[]
  category: AgentCategory
  aliases?: string[]
  /** Path to project-level MCP server config file, relative to project root. Null if agent doesn't support MCP. */
  mcpConfigPath: string | null
  /** Path to global MCP server config file. Uses ~ for home dir. Null if agent doesn't support MCP. */
  globalMcpConfigPath: string | null
  /** MCP config format identifier. Determines how to write server entries. Null if agent doesn't support MCP. */
  mcpConfigFormat: McpConfigFormat | null
  /** Path to project-level agents directory, relative to project root. */
  agentsPath?: string
  /** Path to global agents directory. Uses ~ for home dir. */
  globalAgentsPath?: string
  /** Path to project-level commands directory, relative to project root. */
  commandsPath?: string
  /** Path to global commands directory. Uses ~ for home dir. */
  globalCommandsPath?: string
}

/** Map of alias → canonical AgentId for renamed/alternate IDs */
const AGENT_ALIASES: Record<string, AgentId> = {
  gemini: 'gemini-cli',
  'roo-code': 'roo',
  'github-copilot': 'copilot',
}

/**
 * Resolve a user-supplied agent string to a canonical AgentId.
 * Checks primary IDs first, then aliases.
 */
export function resolveAgentId(id: string): AgentId | null {
  const normalised = id.toLowerCase().trim()
  if ((AGENT_IDS as readonly string[]).includes(normalised)) {
    return normalised as AgentId
  }
  return AGENT_ALIASES[normalised] ?? null
}
