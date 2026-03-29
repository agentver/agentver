import { AGENT_MAP } from './agents/definitions'
import type { AgentId } from './types'

export type TranslatedConfig = {
  agentId: AgentId
  filePath: string
  content: string
}

type ConfigTranslator = {
  agentId: AgentId
  filePath: string | ((name: string) => string)
  transform: (content: string, name: string) => string
}

const markdownPassthrough = (content: string, _name: string) => content

const CONFIG_TRANSLATORS: ConfigTranslator[] = [
  {
    agentId: 'claude-code',
    filePath: 'CLAUDE.md',
    transform: markdownPassthrough,
  },
  {
    agentId: 'claude-cowork',
    filePath: 'CLAUDE.md',
    transform: markdownPassthrough,
  },
  {
    agentId: 'cursor',
    filePath: '.cursorrules',
    transform: markdownPassthrough,
  },
  {
    agentId: 'codex',
    filePath: 'AGENTS.md',
    transform: markdownPassthrough,
  },
  {
    agentId: 'windsurf',
    filePath: '.windsurfrules',
    transform: markdownPassthrough,
  },
  {
    agentId: 'copilot',
    filePath: '.github/copilot-instructions.md',
    transform: markdownPassthrough,
  },
  {
    agentId: 'gemini-cli',
    filePath: 'GEMINI.md',
    transform: markdownPassthrough,
  },
  {
    agentId: 'roo',
    filePath: (name: string) => `.roo/rules/${name}.md`,
    transform: markdownPassthrough,
  },
  {
    agentId: 'goose',
    filePath: '.goose/config.yaml',
    transform: (content: string, _name: string) => {
      const escaped = content.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      return `instructions: "${escaped}"\n`
    },
  },
  {
    agentId: 'junie',
    filePath: '.junie/guidelines.md',
    transform: markdownPassthrough,
  },
  {
    agentId: 'aider',
    filePath: '.aider.conf.yml',
    transform: (_content: string, _name: string) => {
      return `read:\n  - AGENTS.md\n`
    },
  },
  // New agents with specific config formats
  {
    agentId: 'cline',
    filePath: (name: string) => `.clinerules/${name}.md`,
    transform: markdownPassthrough,
  },
  {
    agentId: 'continue',
    filePath: '.continue/config.yaml',
    transform: markdownPassthrough,
  },
  {
    agentId: 'replit',
    filePath: '.replit',
    transform: markdownPassthrough,
  },
]

/**
 * Default fallback: for agents without a specific translator, write
 * markdown content to AGENTS.md (the universal convention).
 */
function getDefaultFilePath(agentId: AgentId, name: string): string {
  const agent = AGENT_MAP.get(agentId)
  if (!agent) return `${name}.md`

  // Universal agents use the AGENTS.md convention
  if (agent.category === 'universal') return 'AGENTS.md'

  // Agent-specific without a translator — use AGENTS.md in their config dir
  const primaryDir = agent.configDirs[0]
  return primaryDir ? `${primaryDir}/AGENTS.md` : 'AGENTS.md'
}

export function translateConfig(
  content: string,
  name: string,
  targetAgents: AgentId[]
): TranslatedConfig[] {
  return targetAgents
    .map((agentId) => {
      const translator = CONFIG_TRANSLATORS.find((t) => t.agentId === agentId)

      if (translator) {
        const filePath =
          typeof translator.filePath === 'function'
            ? translator.filePath(name)
            : translator.filePath
        return {
          agentId,
          filePath,
          content: translator.transform(content, name),
        }
      }

      // Default fallback: markdown passthrough
      return {
        agentId,
        filePath: getDefaultFilePath(agentId, name),
        content: markdownPassthrough(content, name),
      }
    })
    .filter((result): result is TranslatedConfig => result !== null)
}

export function getGlobalConfigFilePath(agentId: AgentId, name: string): string | null {
  const configPath = getConfigFilePath(agentId, name)
  if (!configPath) return null

  const agent = AGENT_MAP.get(agentId)
  if (!agent) return null

  const primaryDir = agent.configDirs[0]
  if (!primaryDir) return `~/${configPath}`

  // If configPath already starts with the configDir (e.g. .roo/rules/name.md), avoid double-prefixing
  if (configPath.startsWith(`${primaryDir}/`)) return `~/${configPath}`

  return `~/${primaryDir}/${configPath}`
}

export function getConfigFilePath(agentId: AgentId, name: string): string | null {
  const translator = CONFIG_TRANSLATORS.find((t) => t.agentId === agentId)
  if (translator) {
    return typeof translator.filePath === 'function'
      ? translator.filePath(name)
      : translator.filePath
  }
  // Fallback for agents without explicit translators
  return getDefaultFilePath(agentId, name)
}
