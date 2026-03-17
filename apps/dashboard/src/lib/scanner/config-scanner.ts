import {
  AGENT_DEFINITIONS,
  type DetectedFileType,
  inferDetectedType,
} from '@agentver/agent-definitions'

type ScannableFile = {
  path: string
  agentId: string
  agentName: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
}

export function getScannablePatterns(): ScannableFile[] {
  const patterns: ScannableFile[] = []

  for (const agent of AGENT_DEFINITIONS) {
    for (const configFile of agent.configFiles) {
      patterns.push({
        path: configFile,
        agentId: agent.id,
        agentName: agent.name,
        type: 'config',
        detectedType: 'AGENT_CONFIG',
      })
    }

    patterns.push({
      path: `${agent.projectSkillPath}/**`,
      agentId: agent.id,
      agentName: agent.name,
      type: 'skill',
      detectedType: 'SKILL',
    })
  }

  return patterns
}

export function identifyAgentFromPath(
  filePath: string
): { agentId: string; type: string; detectedType: DetectedFileType } | null {
  const fileName = filePath.split('/').pop() ?? filePath

  for (const agent of AGENT_DEFINITIONS) {
    if (filePath.startsWith(agent.projectSkillPath)) {
      return { agentId: agent.id, type: 'skill', detectedType: inferDetectedType(fileName) }
    }

    for (const configFile of agent.configFiles) {
      if (filePath === configFile || filePath.endsWith(`/${configFile}`)) {
        return { agentId: agent.id, type: 'config', detectedType: 'AGENT_CONFIG' }
      }
    }
  }

  return null
}
