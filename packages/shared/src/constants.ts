export const PACKAGE_TYPES = [
  'SKILL',
  'AGENT_CONFIG',
  'PLUGIN',
  'SCRIPT',
  'PROMPT',
  'BUNDLE',
  'AGENT',
  'COMMAND',
] as const
export type PackageType = (typeof PACKAGE_TYPES)[number]

export const WARNING_NO_LICENCE =
  'No licence specified. Consider adding an SPDX licence identifier.'

export const VISIBILITY_LEVELS = ['PUBLIC', 'PRIVATE', 'TEAM'] as const
export type VisibilityLevel = (typeof VISIBILITY_LEVELS)[number]
