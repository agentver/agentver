import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_DEFINITIONS } from './agents/definitions'
import type { AgentId } from './types'

export type DetectedFileType = 'SKILL' | 'AGENT_CONFIG' | 'PLUGIN' | 'SCRIPT' | 'PROMPT'

export type DetectedAgent = {
  id: AgentId
  name: string
  configPath: string
}

export type ScannedFile = {
  path: string
  agentId: AgentId
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  name: string
}

/** Agents that should never be auto-detected — only via explicit --agent flag */
const NEVER_AUTO_DETECT: ReadonlySet<AgentId> = new Set(['universal'])

export function detectInstalledAgents(directory: string): DetectedAgent[] {
  const detected: DetectedAgent[] = []

  for (const agent of AGENT_DEFINITIONS) {
    if (NEVER_AUTO_DETECT.has(agent.id)) continue

    for (const configDir of agent.configDirs) {
      const fullPath = join(directory, configDir)
      if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
        detected.push({
          id: agent.id,
          name: agent.name,
          configPath: fullPath,
        })
        break
      }
    }

    for (const configFile of agent.configFiles) {
      const fullPath = join(directory, configFile)
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        const alreadyDetected = detected.some((d) => d.id === agent.id)
        if (!alreadyDetected) {
          detected.push({
            id: agent.id,
            name: agent.name,
            configPath: fullPath,
          })
        }
        break
      }
    }
  }

  return detected
}

/**
 * Detect agents installed globally by checking home directory config paths.
 * Checks both project-style and global paths, deduplicating results.
 */
export function detectGlobalAgents(homeDir: string): DetectedAgent[] {
  const detected: DetectedAgent[] = []
  const seen = new Set<AgentId>()

  for (const agent of AGENT_DEFINITIONS) {
    if (NEVER_AUTO_DETECT.has(agent.id)) continue
    if (seen.has(agent.id)) continue

    // Check global config dirs (e.g. ~/.claude, ~/.cursor)
    for (const configDir of agent.configDirs) {
      const fullPath = join(homeDir, configDir)
      if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
        detected.push({
          id: agent.id,
          name: agent.name,
          configPath: fullPath,
        })
        seen.add(agent.id)
        break
      }
    }

    if (seen.has(agent.id)) continue

    // Check global skill path (e.g. ~/.claude/skills)
    const globalSkillPath = agent.globalSkillPath.replace(/^~/, homeDir)
    if (existsSync(globalSkillPath) && statSync(globalSkillPath).isDirectory()) {
      detected.push({
        id: agent.id,
        name: agent.name,
        configPath: globalSkillPath,
      })
      seen.add(agent.id)
    }
  }

  return detected
}

export function scanForSkillFiles(directory: string): ScannedFile[] {
  const files: ScannedFile[] = []

  for (const agent of AGENT_DEFINITIONS) {
    const skillDir = join(directory, agent.projectSkillPath)
    scanSkillDirectory(skillDir, agent.id, files)

    for (const configFile of agent.configFiles) {
      const fullPath = join(directory, configFile)
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        files.push({
          path: fullPath,
          agentId: agent.id,
          type: 'config',
          detectedType: 'AGENT_CONFIG',
          name: configFile,
        })
      }
    }
  }

  return files
}

/**
 * Scan global skill directories for all detected agents.
 * Checks paths like ~/.claude/skills/, ~/.cursor/skills/, etc.
 */
export function scanGlobalSkillFiles(homeDir: string): ScannedFile[] {
  const files: ScannedFile[] = []
  const seenPaths = new Set<string>()

  for (const agent of AGENT_DEFINITIONS) {
    if (NEVER_AUTO_DETECT.has(agent.id)) continue

    // Check global skill path (e.g. ~/.claude/skills)
    const globalSkillPath = agent.globalSkillPath.replace(/^~/, homeDir)
    scanSkillDirectory(globalSkillPath, agent.id, files, seenPaths)

    // Check global config files (e.g. ~/.claude/CLAUDE.md)
    for (const configFile of agent.configFiles) {
      const fullPath = join(homeDir, configFile)
      if (seenPaths.has(fullPath)) continue
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        files.push({
          path: fullPath,
          agentId: agent.id,
          type: 'config',
          detectedType: 'AGENT_CONFIG',
          name: configFile,
        })
        seenPaths.add(fullPath)
      }
    }

    // Also check config files inside global config dirs (e.g. ~/.codex/AGENTS.md)
    for (const configDir of agent.configDirs) {
      const dirPath = join(homeDir, configDir)
      if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) continue

      for (const configFile of agent.configFiles) {
        const baseName = configFile.split('/').pop() ?? configFile
        const fullPath = join(dirPath, baseName)
        if (seenPaths.has(fullPath)) continue
        if (existsSync(fullPath) && statSync(fullPath).isFile()) {
          files.push({
            path: fullPath,
            agentId: agent.id,
            type: 'config',
            detectedType: 'AGENT_CONFIG',
            name: `${configDir}/${baseName}`,
          })
          seenPaths.add(fullPath)
        }
      }
    }
  }

  return files
}

function scanSkillDirectory(
  skillDir: string,
  agentId: AgentId,
  files: ScannedFile[],
  seenPaths?: Set<string>
): void {
  if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) return

  const entries = readdirSync(skillDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Check for SKILL.md inside subdirectory
      const skillMd = join(skillDir, entry.name, 'SKILL.md')
      if (existsSync(skillMd)) {
        if (seenPaths?.has(skillMd)) continue
        files.push({
          path: skillMd,
          agentId,
          type: 'skill',
          detectedType: 'SKILL',
          name: entry.name,
        })
        seenPaths?.add(skillMd)
      }
      // Also check for any .md files in the subdirectory (standalone skills)
      try {
        const subEntries = readdirSync(join(skillDir, entry.name), { withFileTypes: true })
        for (const subEntry of subEntries) {
          if (subEntry.isFile() && subEntry.name.endsWith('.md') && subEntry.name !== 'SKILL.md') {
            const filePath = join(skillDir, entry.name, subEntry.name)
            if (seenPaths?.has(filePath)) continue
            files.push({
              path: filePath,
              agentId,
              type: 'skill',
              detectedType: inferDetectedType(subEntry.name),
              name: `${entry.name}/${subEntry.name.replace(/\.md$/, '')}`,
            })
            seenPaths?.add(filePath)
          }
        }
      } catch {
        // Permission denied or other read error
      }
    } else if (entry.name.endsWith('.md')) {
      const filePath = join(skillDir, entry.name)
      if (seenPaths?.has(filePath)) continue
      files.push({
        path: filePath,
        agentId,
        type: 'skill',
        detectedType: inferDetectedType(entry.name),
        name: entry.name.replace(/\.md$/, ''),
      })
      seenPaths?.add(filePath)
    }
  }
}

export function inferDetectedType(fileName: string): DetectedFileType {
  const lower = fileName.toLowerCase()

  if (lower === 'skill.md') return 'SKILL'
  if (lower === 'prompt.md') return 'PROMPT'
  if (lower === 'plugin.json') return 'PLUGIN'
  if (lower === 'script.json') return 'SCRIPT'

  // Agent config files
  const agentConfigPatterns = [
    'claude.md',
    'agents.md',
    'gemini.md',
    '.cursorrules',
    '.windsurfrules',
    'copilot-instructions.md',
    'guidelines.md',
    '.aider.conf.yml',
    'config.yaml',
    // New agent config patterns
    '.clinerules',
    '.replit',
  ]
  if (agentConfigPatterns.some((p) => lower.endsWith(p))) return 'AGENT_CONFIG'

  // Default to SKILL for .md files in skill directories
  return 'SKILL'
}

export function getSkillPlacementPath(
  agentId: AgentId,
  skillName: string,
  scope: 'project' | 'global'
): string | null {
  const agent = AGENT_DEFINITIONS.find((a) => a.id === agentId)
  if (!agent) return null

  const basePath = scope === 'project' ? agent.projectSkillPath : agent.globalSkillPath
  return join(basePath, skillName)
}
