import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DetectedAgent } from '@agentver/agent-definitions'
import { detectInstalledAgents } from '@agentver/agent-definitions'

const AGENTVER_DIR = '.agentver'

/** Resolve the working directory for project-level operations */
export function getWorkingDirectory(): string {
  return process.env.AGENTVER_PROJECT_ROOT ?? process.cwd()
}

/** Resolve the global Agentver config directory (~/.agentver) */
export function getGlobalConfigDirectory(): string {
  return join(homedir(), AGENTVER_DIR)
}

/** Check whether an .agentver directory exists in the given project root */
export function isAgentverProject(projectRoot: string): boolean {
  return existsSync(join(projectRoot, AGENTVER_DIR))
}

/** Detect which AI agents are present in the given directory */
export function detectAgents(directory: string): DetectedAgent[] {
  return detectInstalledAgents(directory)
}

/** Write a diagnostic message to stderr (stdout is reserved for MCP transport) */
export function logDebug(message: string): void {
  process.stderr.write(`[agentver-mcp] ${message}\n`)
}
