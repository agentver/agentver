import type { DetectedFileType } from './shared-types'

export const DETECTED_TYPE_LABELS: Record<DetectedFileType, string> = {
  AGENT_CONFIG: 'Agent Config',
  SKILL: 'Skill',
  PLUGIN: 'Plugin',
  SCRIPT: 'Script',
  PROMPT: 'Prompt',
  AGENT: 'Agent',
  COMMAND: 'Command',
}

export const DETECTED_TYPE_COLOURS: Record<DetectedFileType, string> = {
  AGENT_CONFIG: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  SKILL: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  PLUGIN: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
  SCRIPT: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  PROMPT: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
  AGENT: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  COMMAND: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
}

export const AGENT_COLOURS: Record<string, string> = {
  'claude-code': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  cursor: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  codex: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  windsurf: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  copilot: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  gemini: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
  'roo-code': 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  goose: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  junie: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
  aider: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  opencode: 'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200',
}
