import { z } from 'zod'

// --- MCP Transport Types ---

export const mcpTransportSchema = z.enum(['stdio', 'http', 'sse'])
export type McpTransport = z.infer<typeof mcpTransportSchema>

// --- Credential Source ---
// Where to fetch the credential value from

export const credentialSourceSchema = z.enum(['vault', 'prompt', 'env', 'oauth'])
export type CredentialSource = z.infer<typeof credentialSourceSchema>

// --- Credential Sharing Mode ---

export const credentialSharingSchema = z.enum(['individual', 'team', 'org'])
export type CredentialSharing = z.infer<typeof credentialSharingSchema>

// --- MCP Server Credential Requirement ---

export const mcpCredentialRequirementSchema = z.object({
  key: z.string().min(1).max(128),
  description: z.string().max(500),
  source: credentialSourceSchema,
  vaultKey: z.string().min(1).max(128).optional(),
  envVar: z.string().min(1).max(128).optional(),
  oauthProvider: z.string().min(1).max(64).optional(),
  required: z.boolean().default(true),
})

export type McpCredentialRequirement = z.infer<typeof mcpCredentialRequirementSchema>

// --- MCP Server Source ---
// Where the MCP server binary/package comes from

export const mcpServerSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('npm'),
    package: z.string().min(1),
    version: z.string().optional(),
  }),
  z.object({
    type: z.literal('git'),
    uri: z.string().min(1),
    ref: z.string().optional(),
  }),
  z.object({
    type: z.literal('docker'),
    image: z.string().min(1),
    tag: z.string().optional(),
  }),
  z.object({
    type: z.literal('url'),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal('local'),
    path: z.string().min(1),
  }),
])

export type McpServerSource = z.infer<typeof mcpServerSourceSchema>

// --- MCP Server Config ---
// A single MCP server configuration within a bundle

export const mcpServerConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  description: z.string().max(500).optional(),
  source: mcpServerSourceSchema.optional(),
  transport: mcpTransportSchema.default('stdio'),

  // stdio transport fields
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),

  // http/sse transport fields
  url: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),

  // Environment variables (may contain ${credentials.<key>} placeholders)
  env: z.record(z.string(), z.string()).optional(),

  // Credential requirements
  credentials: z.array(mcpCredentialRequirementSchema).optional(),
})

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>

// --- Credential Definition ---
// Top-level credential definition in a bundle

export const bundleCredentialDefinitionSchema = z.object({
  description: z.string().max(500),
  required: z.boolean().default(true),
  sharing: credentialSharingSchema.default('individual'),
  rotationDays: z.number().int().positive().optional(),
})

export type BundleCredentialDefinition = z.infer<typeof bundleCredentialDefinitionSchema>

// --- Bundle Package Reference ---
// A reference to an included package within a bundle

export const bundlePackageRefSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  optional: z.boolean().default(false),
})

export type BundlePackageRef = z.infer<typeof bundlePackageRefSchema>

// --- Bundle Manifest ---
// The top-level schema for agentver.bundle.yaml

export const bundleManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, 'Must be valid semver'),
  description: z.string().max(1000).optional(),
  extends: z.string().optional(),

  includes: z
    .object({
      skills: z.array(bundlePackageRefSchema).optional(),
      prompts: z.array(bundlePackageRefSchema).optional(),
      rules: z.array(bundlePackageRefSchema).optional(),
      plugins: z.array(bundlePackageRefSchema).optional(),
      scripts: z.array(bundlePackageRefSchema).optional(),
    })
    .optional(),

  mcpServers: z.array(mcpServerConfigSchema).optional(),

  credentials: z.record(z.string(), bundleCredentialDefinitionSchema).optional(),
})

export type BundleManifest = z.infer<typeof bundleManifestSchema>

// --- MCP Config Output Formats ---
// What gets written to agent-native config files

export const mcpServerEntrySchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
})

export type McpServerEntry = z.infer<typeof mcpServerEntrySchema>

// mcp-servers format: { mcpServers: { [name]: McpServerEntry } }
export const mcpServersFormatSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerEntrySchema),
})

export type McpServersFormat = z.infer<typeof mcpServersFormatSchema>

// vscode-servers format: { servers: { [name]: { type: 'stdio', ...McpServerEntry } } }
export const vscodeServerEntrySchema = mcpServerEntrySchema.extend({
  type: z.enum(['stdio', 'sse']).default('stdio'),
})

export const vscodeServersFormatSchema = z.object({
  servers: z.record(z.string(), vscodeServerEntrySchema),
})

export type VscodeServersFormat = z.infer<typeof vscodeServersFormatSchema>
