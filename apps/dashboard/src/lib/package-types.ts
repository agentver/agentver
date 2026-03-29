export const PACKAGE_TYPE_DISPLAY: Record<string, { label: string; colour: string }> = {
  SKILL: { label: 'Skill', colour: 'bg-blue-100 text-blue-800' },
  AGENT_CONFIG: { label: 'Agent Config', colour: 'bg-purple-100 text-purple-800' },
  PLUGIN: { label: 'Plugin', colour: 'bg-amber-100 text-amber-800' },
  SCRIPT: { label: 'Script', colour: 'bg-green-100 text-green-800' },
  PROMPT: { label: 'Prompt', colour: 'bg-rose-100 text-rose-800' },
  AGENT: { label: 'Agent', colour: 'bg-teal-100 text-teal-800' },
  COMMAND: { label: 'Command', colour: 'bg-indigo-100 text-indigo-800' },
}

export type PackageType = keyof typeof PACKAGE_TYPE_DISPLAY
