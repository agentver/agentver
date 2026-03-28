import { z } from 'zod'

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

export const skillMetadataSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, 'Must be valid semver'),
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

const installedPackageSchema = z.object({
  name: z.string(),
  version: z.string(),
  agents: z.array(z.string()).default([]),
  installedAt: z.string().datetime(),
})

export const manifestSchema = z.object({
  version: z.literal(1),
  packages: z.record(z.string(), installedPackageSchema),
})

export type Manifest = z.infer<typeof manifestSchema>

const lockedPackageSchema = z.object({
  version: z.string(),
  resolved: z.string().url(),
  integrity: z.string().regex(/^sha256-/),
  agents: z.array(z.string()),
})

export const lockfileSchema = z.object({
  version: z.literal(1),
  packages: z.record(z.string(), lockedPackageSchema),
})

export type Lockfile = z.infer<typeof lockfileSchema>

// --- v2 schemas ---

export const gitSourceSchema = z.object({
  type: z.literal('git'),
  uri: z.string().min(1),
  path: z.string(),
  ref: z.string().min(1),
  commit: z.string().min(7),
})

export type GitSource = z.infer<typeof gitSourceSchema>

export const wellKnownSourceSchema = z.object({
  type: z.literal('well-known'),
  baseUrl: z.string().min(1),
  hostname: z.string().min(1),
  skillName: z.string().min(1),
})

export type WellKnownSource = z.infer<typeof wellKnownSourceSchema>

export const packageSourceSchema = z.discriminatedUnion('type', [
  gitSourceSchema,
  wellKnownSourceSchema,
])

export type PackageSource = z.infer<typeof packageSourceSchema>

export const manifestV2PackageSchema = z.object({
  source: packageSourceSchema,
  agents: z.array(z.string()).default([]),
  installedAt: z.string().datetime(),
  modified: z.boolean().default(false),
  pinned: z.boolean().optional(),
  path: z.string().optional(),
  packageType: z.enum(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT', 'BUNDLE', 'AGENT', 'COMMAND']).optional(),
  entryFile: z.string().optional(),
})

export type ManifestV2Package = z.infer<typeof manifestV2PackageSchema>

export const manifestV2Schema = z.object({
  version: z.literal(2),
  packages: z.record(z.string(), manifestV2PackageSchema),
})

export type ManifestV2 = z.infer<typeof manifestV2Schema>

export const lockfileV2PackageSchema = z.object({
  source: packageSourceSchema,
  integrity: z.string().regex(/^sha256-/),
  agents: z.array(z.string()),
})

export type LockfileV2Package = z.infer<typeof lockfileV2PackageSchema>

export const lockfileV2Schema = z.object({
  version: z.literal(2),
  packages: z.record(z.string(), lockfileV2PackageSchema),
})

export type LockfileV2 = z.infer<typeof lockfileV2Schema>

export const manifestAnySchema = z.discriminatedUnion('version', [manifestSchema, manifestV2Schema])

export type ManifestAny = z.infer<typeof manifestAnySchema>

export const lockfileAnySchema = z.discriminatedUnion('version', [lockfileSchema, lockfileV2Schema])

export type LockfileAny = z.infer<typeof lockfileAnySchema>

// --- v1 → v2 migration helpers ---

export function migrateManifestV1ToV2(v1: Manifest): ManifestV2 {
  const packages: ManifestV2['packages'] = {}

  for (const [name, pkg] of Object.entries(v1.packages)) {
    packages[name] = {
      source: {
        type: 'git',
        uri: 'unknown',
        path: '',
        ref: pkg.version,
        commit: 'unknown',
      },
      agents: pkg.agents,
      installedAt: pkg.installedAt,
      modified: false,
    }
  }

  return { version: 2, packages }
}

export function migrateLockfileV1ToV2(v1: Lockfile): LockfileV2 {
  const packages: LockfileV2['packages'] = {}

  for (const [name, pkg] of Object.entries(v1.packages)) {
    packages[name] = {
      source: {
        type: 'git',
        uri: 'unknown',
        path: '',
        ref: pkg.version,
        commit: 'unknown',
      },
      integrity: pkg.integrity,
      agents: pkg.agents,
    }
  }

  return { version: 2, packages }
}

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
