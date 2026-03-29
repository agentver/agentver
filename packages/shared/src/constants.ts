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

/**
 * Semver regex per the semver.org 2.0.0 specification.
 *
 * Rejects leading zeros on numeric segments (e.g. `01.0.0`).
 * Accepts optional pre-release (`-alpha.1`) and build metadata (`+build.42`).
 */
export const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
