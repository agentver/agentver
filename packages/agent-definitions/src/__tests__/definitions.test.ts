import { describe, expect, it } from 'vitest'
import {
  AGENT_DEFINITIONS,
  AGENT_MAP,
  getAgentCapableAgents,
  getCommandCapableAgents,
  getMcpCapableAgents,
} from '../agents/definitions'
import { AGENT_IDS } from '../types'

describe('AGENT_DEFINITIONS', () => {
  it('should contain exactly 43 definitions', () => {
    expect(AGENT_DEFINITIONS).toHaveLength(43)
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

  it('should have 39 agent-specific and 4 universal agents', () => {
    const agentSpecific = AGENT_DEFINITIONS.filter((d) => d.category === 'agent-specific')
    const universal = AGENT_DEFINITIONS.filter((d) => d.category === 'universal')
    expect(agentSpecific).toHaveLength(39)
    expect(universal).toHaveLength(4)
  })

  it('should have aliases only on copilot, gemini-cli, and roo', () => {
    const withAliases = AGENT_DEFINITIONS.filter((d) => d.aliases && d.aliases.length > 0)
    const aliasIds = withAliases.map((d) => d.id).sort()
    expect(aliasIds).toEqual(['copilot', 'gemini-cli', 'roo'])
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
  it('should contain entries for all 43 agent IDs', () => {
    expect(AGENT_MAP.size).toBe(43)
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
