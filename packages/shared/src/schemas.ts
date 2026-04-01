import { z } from 'zod'
import { SEMVER_REGEX } from './constants'

// Canonical list lives in @agentver/agent-definitions/types.ts — kept in sync by a test.
// Not imported directly because @agentver/shared is published to npm and
// @agentver/agent-definitions is a private workspace-only package.
const AGENT_IDS_FOR_SCHEMA = [
  'adal',
  'aider',
  'amp',
  'antigravity',
  'augment',
  'claude-code',
  'claude-cowork',
  'cline',
  'codebuddy',
  'codex',
  'command-code',
  'continue',
  'copilot',
  'cortex',
  'crush',
  'cursor',
  'droid',
  'gemini-cli',
  'goose',
  'iflow-cli',
  'junie',
  'kilo',
  'kimi-cli',
  'kiro-cli',
  'kode',
  'mcpjam',
  'mistral-vibe',
  'mux',
  'neovate',
  'openclaw',
  'opencode',
  'openhands',
  'pi',
  'pochi',
  'qoder',
  'qwen-code',
  'replit',
  'roo',
  'trae',
  'trae-cn',
  'universal',
  'windsurf',
  'zencoder',
] as const

export const agentIdEnum = z.enum(AGENT_IDS_FOR_SCHEMA)

export const STORAGE_SCHEMA_VERSION = 2 as const

export const skillMetadataSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  version: z.string().regex(SEMVER_REGEX, 'Must be valid semver'),
  type: z.enum([
    'SKILL',
    'AGENT_CONFIG',
    'PLUGIN',
    'SCRIPT',
    'PROMPT',
    'BUNDLE',
    'AGENT',
    'COMMAND',
  ]),
  tags: z.array(z.string().max(50)).max(20).default([]),
  agents: z.array(agentIdEnum).default([]),
})

export type SkillMetadata = z.infer<typeof skillMetadataSchema>

export const gitSourceSchema = z.object({
  type: z.literal('git'),
  uri: z.string().min(1),
  path: z.string(),
  ref: z.string().min(1),
  commit: z.string().min(7),
})

export type GitSource = z.infer<typeof gitSourceSchema>

export const localSourceSchema = z.object({
  type: z.literal('local'),
  path: z.string().min(1),
})

export type LocalSource = z.infer<typeof localSourceSchema>

export const platformSourceSchema = z.object({
  type: z.literal('platform'),
  uri: z.string().min(1),
  path: z.string(),
  ref: z.string().min(1),
  commit: z.string().min(7),
})

export type PlatformSource = z.infer<typeof platformSourceSchema>

export const unknownSourceSchema = z.object({
  type: z.literal('unknown'),
  path: z.string().optional(),
  ref: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
})

export type UnknownSource = z.infer<typeof unknownSourceSchema>

export const wellKnownSourceSchema = z.object({
  type: z.literal('well-known'),
  baseUrl: z.string().min(1),
  hostname: z.string().min(1),
  skillName: z.string().min(1),
})

export type WellKnownSource = z.infer<typeof wellKnownSourceSchema>

export const packageSourceSchema = z.discriminatedUnion('type', [
  gitSourceSchema,
  localSourceSchema,
  platformSourceSchema,
  unknownSourceSchema,
  wellKnownSourceSchema,
])

export type PackageSource = z.infer<typeof packageSourceSchema>

export function normalisePackageSource(source: PackageSource): PackageSource {
  if (source.type !== 'git') {
    return source
  }

  if (source.uri === 'local') {
    return {
      type: 'local',
      path: source.path,
    }
  }

  if (source.uri === 'unknown') {
    return {
      type: 'unknown',
      path: source.path,
      ref: source.ref,
      commit: source.commit,
    }
  }

  if (source.uri.startsWith('agentver://')) {
    return {
      type: 'platform',
      uri: source.uri,
      path: source.path,
      ref: source.ref,
      commit: source.commit,
    }
  }

  return source
}

export function getPackageSourceLocation(source: PackageSource): string {
  switch (source.type) {
    case 'git':
    case 'platform':
      return source.path ? `${source.uri}/${source.path}` : source.uri
    case 'well-known':
      return `${source.hostname}/${source.skillName}`
    case 'local':
      return source.path
    case 'unknown':
      return source.path ?? 'unknown'
  }
}

export function getPackageSourceReference(source: PackageSource): string {
  switch (source.type) {
    case 'git':
    case 'platform':
      return source.ref
    case 'well-known':
      return 'well-known'
    case 'local':
      return 'local'
    case 'unknown':
      return source.ref ?? 'unknown'
  }
}

export function getPackageSourceCommit(source: PackageSource): string {
  switch (source.type) {
    case 'git':
    case 'platform':
      return source.commit
    case 'unknown':
      return source.commit ?? 'unknown'
    case 'well-known':
    case 'local':
      return ''
  }
}

export function createPackageKey(displayName: string, source: PackageSource): string {
  const identity = (() => {
    switch (source.type) {
      case 'git':
        return `${source.uri}#${source.path}#${source.ref}`
      case 'platform':
        return `${source.uri}#${source.path}#${source.ref}`
      case 'well-known':
        return `${source.baseUrl}#${source.skillName}`
      case 'local':
        return source.path
      case 'unknown':
        return [source.path ?? '', source.ref ?? '', source.commit ?? '', displayName].join('#')
    }
  })()

  return `${source.type}:${encodeURIComponent(identity)}`
}

/**
 * Extracts file entries from a registry download response's fileManifest.
 *
 * The fileManifest is stored as JSON — it may be:
 * - A record of { [filename]: content } (flat map)
 * - An array of { path, content } objects
 * - An empty object
 */
export function extractFilesFromManifest(
  fileManifest: Record<string, unknown> | unknown[]
): Array<{ path: string; content: string }> {
  if (Array.isArray(fileManifest)) {
    return fileManifest.filter((entry): entry is { path: string; content: string } => {
      if (typeof entry !== 'object' || entry === null) return false
      const record = entry as Record<string, unknown>
      return typeof record.path === 'string' && typeof record.content === 'string'
    })
  }

  return Object.entries(fileManifest)
    .filter(([, value]) => typeof value === 'string')
    .map(([path, content]) => ({ path, content: content as string }))
}

export function getPackageDisplayName(manifestKey: string, pkg: { name?: string }): string {
  return pkg.name?.trim() || manifestKey
}

export const manifestV2PackageSchema = z.object({
  name: z.string().min(1).optional(),
  source: packageSourceSchema,
  agents: z.array(z.string()).default([]),
  installedAt: z.string().datetime(),
  modified: z.boolean().default(false),
  pinned: z.boolean().optional(),
  path: z.string().optional(),
  bundle: z.string().optional(),
  packageType: z
    .enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT', 'BUNDLE', 'AGENT', 'COMMAND'])
    .optional(),
  entryFile: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  conflictsWith: z.array(z.string()).optional(),
})

export type ManifestV2Package = z.infer<typeof manifestV2PackageSchema>

export const manifestV2Schema = z.object({
  version: z.literal(STORAGE_SCHEMA_VERSION),
  packages: z.record(z.string(), manifestV2PackageSchema),
})

export type ManifestV2 = z.infer<typeof manifestV2Schema>

export function normaliseManifestV2(manifest: ManifestV2): ManifestV2 {
  const packages = Object.fromEntries(
    Object.entries(manifest.packages).map(([name, pkg]) => {
      const source = normalisePackageSource(pkg.source)
      const displayName = getPackageDisplayName(name, pkg)
      const stableKey = createPackageKey(displayName, source)

      return [
        stableKey,
        {
          name: displayName,
          ...pkg,
          source,
        },
      ]
    })
  )

  return {
    version: STORAGE_SCHEMA_VERSION,
    packages,
  }
}

export const linkModeSchema = z.enum(['symlink', 'copy', 'junction'])
export type LinkMode = z.infer<typeof linkModeSchema>

export const lockfileV2PackageSchema = z.object({
  name: z.string().min(1).optional(),
  source: packageSourceSchema,
  integrity: z.string().regex(/^sha256-/),
  agents: z.array(z.string()),
  /** Filesystem link mode used for agent placements. */
  linkMode: linkModeSchema.optional(),
  /** True when a fallback link mode was used instead of the preferred mode. */
  degraded: z.boolean().optional(),
})

export type LockfileV2Package = z.infer<typeof lockfileV2PackageSchema>

export const lockfileV2Schema = z.object({
  version: z.literal(STORAGE_SCHEMA_VERSION),
  packages: z.record(z.string(), lockfileV2PackageSchema),
})

export type LockfileV2 = z.infer<typeof lockfileV2Schema>

export function normaliseLockfileV2(lockfile: LockfileV2): LockfileV2 {
  const packages = Object.fromEntries(
    Object.entries(lockfile.packages).map(([name, pkg]) => {
      const source = normalisePackageSource(pkg.source)
      const displayName = getPackageDisplayName(name, pkg)
      const stableKey = createPackageKey(displayName, source)

      return [
        stableKey,
        {
          name: displayName,
          ...pkg,
          source,
        },
      ]
    })
  )

  return {
    version: STORAGE_SCHEMA_VERSION,
    packages,
  }
}

export const manifestSchema = manifestV2Schema
export type Manifest = ManifestV2
export const lockfileSchema = lockfileV2Schema
export type Lockfile = LockfileV2
export const manifestAnySchema = manifestV2Schema
export type ManifestAny = ManifestV2
export const lockfileAnySchema = lockfileV2Schema
export type LockfileAny = LockfileV2

// --- Package structure ---

export const packageStructureSchema = z.object({
  type: z.enum([
    'SKILL',
    'AGENT_CONFIG',
    'PLUGIN',
    'SCRIPT',
    'PROMPT',
    'BUNDLE',
    'AGENT',
    'COMMAND',
  ]),
  entryFile: z.string(),
  requiredFiles: z.array(z.string()).default([]),
  optionalDirs: z.array(z.string()).default([]),
})

export type PackageStructure = z.infer<typeof packageStructureSchema>

export const PACKAGE_STRUCTURES: Record<string, PackageStructure> = {
  SKILL: {
    type: 'SKILL',
    entryFile: 'SKILL.md',
    requiredFiles: ['SKILL.md'],
    optionalDirs: ['scripts', 'references', 'assets'],
  },
  AGENT_CONFIG: {
    type: 'AGENT_CONFIG',
    entryFile: 'CLAUDE.md',
    requiredFiles: [],
    optionalDirs: ['rules', 'hooks'],
  },
  PLUGIN: {
    type: 'PLUGIN',
    entryFile: 'plugin.json',
    requiredFiles: ['plugin.json'],
    optionalDirs: ['scripts', 'mcp'],
  },
  SCRIPT: {
    type: 'SCRIPT',
    entryFile: 'script.json',
    requiredFiles: ['script.json'],
    optionalDirs: ['src'],
  },
  PROMPT: {
    type: 'PROMPT',
    entryFile: 'PROMPT.md',
    requiredFiles: ['PROMPT.md'],
    optionalDirs: ['variants'],
  },
  BUNDLE: {
    type: 'BUNDLE',
    entryFile: 'agentver.bundle.yaml',
    requiredFiles: ['agentver.bundle.yaml'],
    optionalDirs: ['skills', 'mcp-servers', 'prompts', 'rules', 'scripts'],
  },
  AGENT: {
    type: 'AGENT',
    entryFile: 'AGENT.md',
    requiredFiles: ['AGENT.md'],
    optionalDirs: [],
  },
  COMMAND: {
    type: 'COMMAND',
    entryFile: 'COMMAND.md',
    requiredFiles: ['COMMAND.md'],
    optionalDirs: [],
  },
}

// --- Entry file schemas per package type ---

export const skillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/)
    .optional(),
  license: z.string().optional(),
  compatibility: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => {
      if (typeof val === 'string')
        return val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      return val
    }),
  metadata: z.record(z.string(), z.string()).optional(),
  'allowed-tools': z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => {
      if (typeof val === 'string') return val.split(/\s+/).filter(Boolean)
      return val
    }),
})

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>

export const AGENT_CONFIG_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  '.cursorrules',
  '.windsurfrules',
  '.github/copilot-instructions.md',
  '.goose/config.yaml',
  '.roo/rules',
  '.cursor/rules',
  '.junie/guidelines.md',
] as const

export type AgentConfigFile = (typeof AGENT_CONFIG_FILES)[number]

export const pluginManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/)
    .optional(),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        command: z.string().optional(),
      })
    )
    .optional(),
  hooks: z.record(z.string(), z.string()).optional(),
  rules: z.array(z.string()).optional(),
  mcp: z
    .object({
      serverCommand: z.string(),
      args: z.array(z.string()).optional(),
    })
    .optional(),
})

export type PluginManifest = z.infer<typeof pluginManifestSchema>

export const scriptManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/)
    .optional(),
  runtime: z.enum(['node', 'bun', 'python', 'bash']),
  entryPoint: z.string().min(1),
  args: z.array(z.string()).optional(),
})

export type ScriptManifest = z.infer<typeof scriptManifestSchema>

export const promptFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/)
    .optional(),
  category: z.string().optional(),
  variables: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        required: z.boolean().optional(),
        default: z.string().optional(),
      })
    )
    .optional(),
})

export type PromptFrontmatter = z.infer<typeof promptFrontmatterSchema>

// --- File manifest ---

export const fileManifestEntrySchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  hash: z.string(),
  contentType: z.string().default('text/plain'),
})

export type FileManifestEntry = z.infer<typeof fileManifestEntrySchema>

export const fileManifestSchema = z.object({
  files: z.array(fileManifestEntrySchema),
  totalSize: z.number().int().nonnegative(),
  entryFile: z.string(),
  packageType: z.enum([
    'SKILL',
    'AGENT_CONFIG',
    'PLUGIN',
    'SCRIPT',
    'PROMPT',
    'BUNDLE',
    'AGENT',
    'COMMAND',
  ]),
})

export type FileManifest = z.infer<typeof fileManifestSchema>

// --- Agent config ---

export const agentConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  targetAgents: z.array(agentIdEnum).min(1),
  composable: z.boolean().default(false),
  baseConfig: z.string().optional(),
  sections: z.array(z.string()).optional(),
})

export type AgentConfig = z.infer<typeof agentConfigSchema>
