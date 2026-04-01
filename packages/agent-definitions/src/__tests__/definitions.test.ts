import { describe, expect, it } from 'vitest'
import {
  AGENT_DEFINITIONS,
  AGENT_MAP,
  getAgentCapableAgents,
  getCommandCapableAgents,
  getMcpCapableAgents,
} from '../agents/definitions'
import type { AgentDefinition } from '../types'
import { AGENT_IDS } from '../types'

/** Minimal agent definition stub for predicate tests */
function stubAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    projectSkillPath: '.claude',
    globalSkillPath: '~/.claude',
    configFiles: [],
    configDirs: [],
    category: 'agent-specific',
    mcpConfigPath: null,
    globalMcpConfigPath: null,
    mcpConfigFormat: null,
    ...overrides,
  }
}

/** Mirrors the predicate used by getAgentCapableAgents */
function isAgentCapable(a: AgentDefinition): boolean {
  return Boolean(a.agentsPath?.trim() || a.globalAgentsPath?.trim())
}

/** Mirrors the predicate used by getCommandCapableAgents */
function isCommandCapable(a: AgentDefinition): boolean {
  return Boolean(a.commandsPath?.trim() || a.globalCommandsPath?.trim())
}

describe('AGENT_DEFINITIONS', () => {
  it('should contain exactly 44 definitions', () => {
    expect(AGENT_DEFINITIONS).toHaveLength(44)
  })

  it('should have no duplicate IDs', () => {
    const ids = AGENT_DEFINITIONS.map((d) => d.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('should have all required fields for every definition', () => {
    for (const def of AGENT_DEFINITIONS) {
      expect(def).toHaveProperty('id')
      expect(def).toHaveProperty('name')
      expect(def).toHaveProperty('projectSkillPath')
      expect(def).toHaveProperty('globalSkillPath')
      expect(def).toHaveProperty('configFiles')
      expect(def).toHaveProperty('configDirs')
      expect(def).toHaveProperty('category')
      expect(typeof def.id).toBe('string')
      expect(typeof def.name).toBe('string')
      expect(typeof def.projectSkillPath).toBe('string')
      expect(typeof def.globalSkillPath).toBe('string')
      expect(Array.isArray(def.configFiles)).toBe(true)
      expect(Array.isArray(def.configDirs)).toBe(true)
      expect(['universal', 'agent-specific']).toContain(def.category)
    }
  })

  it('should have 40 agent-specific and 4 universal agents', () => {
    const agentSpecific = AGENT_DEFINITIONS.filter((d) => d.category === 'agent-specific')
    const universal = AGENT_DEFINITIONS.filter((d) => d.category === 'universal')
    expect(agentSpecific).toHaveLength(40)
    expect(universal).toHaveLength(4)
  })

  it('should have aliases only on copilot, gemini-cli, and roo', () => {
    const withAliases = AGENT_DEFINITIONS.filter((d) => d.aliases && d.aliases.length > 0)
    const aliasIds = withAliases.map((d) => d.id).sort()
    expect(aliasIds).toEqual(['copilot', 'forgecode', 'gemini-cli', 'roo'])
  })

  it('should match all IDs from AGENT_IDS', () => {
    const definitionIds = AGENT_DEFINITIONS.map((d) => d.id).sort()
    const sortedAgentIds = [...AGENT_IDS].sort()
    expect(definitionIds).toEqual(sortedAgentIds)
  })

  it('should have agents and commands paths on claude-code', () => {
    const claudeCode = AGENT_MAP.get('claude-code')!
    expect(claudeCode.agentsPath).toBe('.claude/agents')
    expect(claudeCode.globalAgentsPath).toBe('~/.claude/agents')
    expect(claudeCode.commandsPath).toBe('.claude/commands')
    expect(claudeCode.globalCommandsPath).toBe('~/.claude/commands')
  })

  it('should have agents and commands paths on claude-cowork', () => {
    const claudeCowork = AGENT_MAP.get('claude-cowork')!
    expect(claudeCowork.agentsPath).toBe('.claude/agents')
    expect(claudeCowork.globalAgentsPath).toBe('~/.claude/agents')
    expect(claudeCowork.commandsPath).toBe('.claude/commands')
    expect(claudeCowork.globalCommandsPath).toBe('~/.claude/commands')
  })

  it('should have no agents/commands paths on other agents', () => {
    const others = AGENT_DEFINITIONS.filter(
      (d) => d.id !== 'claude-code' && d.id !== 'claude-cowork'
    )
    for (const def of others) {
      expect(def.agentsPath).toBeUndefined()
      expect(def.globalAgentsPath).toBeUndefined()
      expect(def.commandsPath).toBeUndefined()
      expect(def.globalCommandsPath).toBeUndefined()
    }
  })
})

describe('getAgentCapableAgents', () => {
  it('should return only claude-code and claude-cowork', () => {
    const agents = getAgentCapableAgents()
    const ids = agents.map((a) => a.id).sort()
    expect(ids).toEqual(['claude-code', 'claude-cowork'])
  })

  it('should have both agentsPath and globalAgentsPath defined', () => {
    const agents = getAgentCapableAgents()
    for (const agent of agents) {
      expect(agent.agentsPath).toBeDefined()
      expect(agent.globalAgentsPath).toBeDefined()
    }
  })

  it('should match an agent with only a project-level agentsPath', () => {
    const agent = stubAgent({ agentsPath: '.my/agents', globalAgentsPath: undefined })
    expect(isAgentCapable(agent)).toBe(true)
  })

  it('should match an agent with only a global-level agentsPath', () => {
    const agent = stubAgent({ agentsPath: undefined, globalAgentsPath: '~/.my/agents' })
    expect(isAgentCapable(agent)).toBe(true)
  })

  it('should reject an agent with empty-string agentsPath values', () => {
    const agent = stubAgent({ agentsPath: '', globalAgentsPath: '' })
    expect(isAgentCapable(agent)).toBe(false)
  })

  it('should reject an agent with whitespace-only agentsPath values', () => {
    const agent = stubAgent({ agentsPath: '  ', globalAgentsPath: '  ' })
    expect(isAgentCapable(agent)).toBe(false)
  })
})

describe('getCommandCapableAgents', () => {
  it('should return only claude-code and claude-cowork', () => {
    const agents = getCommandCapableAgents()
    const ids = agents.map((a) => a.id).sort()
    expect(ids).toEqual(['claude-code', 'claude-cowork'])
  })

  it('should have both commandsPath and globalCommandsPath defined', () => {
    const agents = getCommandCapableAgents()
    for (const agent of agents) {
      expect(agent.commandsPath).toBeDefined()
      expect(agent.globalCommandsPath).toBeDefined()
    }
  })

  it('should match an agent with only a project-level commandsPath', () => {
    const agent = stubAgent({ commandsPath: '.my/commands', globalCommandsPath: undefined })
    expect(isCommandCapable(agent)).toBe(true)
  })

  it('should match an agent with only a global-level commandsPath', () => {
    const agent = stubAgent({ commandsPath: undefined, globalCommandsPath: '~/.my/commands' })
    expect(isCommandCapable(agent)).toBe(true)
  })

  it('should reject an agent with empty-string commandsPath values', () => {
    const agent = stubAgent({ commandsPath: '', globalCommandsPath: '' })
    expect(isCommandCapable(agent)).toBe(false)
  })

  it('should reject an agent with whitespace-only commandsPath values', () => {
    const agent = stubAgent({ commandsPath: '  ', globalCommandsPath: '  ' })
    expect(isCommandCapable(agent)).toBe(false)
  })
})

describe('getMcpCapableAgents', () => {
  it('should return only agents with at least one MCP config path', () => {
    const mcpAgents = getMcpCapableAgents()
    for (const agent of mcpAgents) {
      expect(agent.mcpConfigPath !== null || agent.globalMcpConfigPath !== null).toBe(true)
    }
  })

  it('should include agents with project-level MCP config', () => {
    const mcpAgents = getMcpCapableAgents()
    const ids = mcpAgents.map((a) => a.id)
    expect(ids).toContain('claude-code')
    expect(ids).toContain('roo')
    expect(ids).toContain('cline')
    expect(ids).toContain('zencoder')
    expect(ids).toContain('kiro-cli')
    expect(ids).toContain('continue')
  })

  it('should ensure all returned agents with mcpConfigFormat also have mcpConfigPath', () => {
    const mcpAgents = getMcpCapableAgents()
    for (const agent of mcpAgents) {
      if (agent.mcpConfigFormat !== null) {
        expect(agent.mcpConfigPath).not.toBeNull()
      }
    }
  })
})

describe('AGENT_MAP', () => {
  it('should contain entries for all 44 agent IDs', () => {
    expect(AGENT_MAP.size).toBe(44)
    for (const id of AGENT_IDS) {
      expect(AGENT_MAP.has(id)).toBe(true)
    }
  })

  it('should return the correct definition for each agent', () => {
    for (const def of AGENT_DEFINITIONS) {
      const mapped = AGENT_MAP.get(def.id)
      expect(mapped).toBeDefined()
      expect(mapped!.id).toBe(def.id)
      expect(mapped!.name).toBe(def.name)
      expect(mapped!.projectSkillPath).toBe(def.projectSkillPath)
      expect(mapped!.globalSkillPath).toBe(def.globalSkillPath)
    }
  })
})
