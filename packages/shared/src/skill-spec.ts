import { z } from 'zod'
import { WARNING_NO_LICENCE } from './constants'
import { parseFrontmatter } from './validation'

// --- Agent Skills spec name validation ---

const SKILL_NAME_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const CONSECUTIVE_HYPHENS_REGEX = /--/

/**
 * Validates a skill name against the agentskills.io spec:
 * - 1-64 characters
 * - Lowercase alphanumeric and hyphens only
 * - Must not start or end with a hyphen
 * - Must not contain consecutive hyphens
 */
function isValidSkillName(name: string): boolean {
  if (name.length < 1 || name.length > 64) return false
  if (!SKILL_NAME_REGEX.test(name)) return false
  if (CONSECUTIVE_HYPHENS_REGEX.test(name)) return false
  return true
}

// --- Agent Skills spec schema (agentskills.io standard) ---

/**
 * The official Agent Skills spec frontmatter fields.
 * Any valid agentskills.io SKILL.md should pass this schema.
 *
 * @see https://agentskills.io/specification
 */
export const agentSkillsSpecSchema = z.object({
  name: z.string().min(1).max(64).refine(isValidSkillName, {
    message:
      'Name must be 1-64 lowercase alphanumeric characters and hyphens. Must not start/end with a hyphen or contain consecutive hyphens.',
  }),
  description: z.string().min(1).max(1024),
  license: z.string().optional(),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  'allowed-tools': z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => {
      if (typeof val === 'string') return val.split(/\s+/).filter(Boolean)
      return val
    }),
})

export type AgentSkillsSpec = z.infer<typeof agentSkillsSpecSchema>

// --- Agentver extended fields (strict superset) ---

/**
 * Agentver extends the Agent Skills spec with additional fields
 * for richer registry features: version pinning, triggers,
 * dependency management, and conflict resolution.
 */
export const agentverSkillSchema = agentSkillsSpecSchema.extend({
  /** Agentver requires semver for registry publishing */
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, 'Must be valid semver')
    .optional(),
  /** Agent compatibility — which agents this skill is designed for */
  'agentver-compatibility': z
    .object({
      agents: z.array(z.string()).optional(),
    })
    .optional(),
  /** Trigger keywords — when agents should activate this skill */
  triggers: z.array(z.string()).optional(),
  /** Extend another skill by name */
  extends: z.string().optional(),
  /** Skills this one depends on */
  dependsOn: z.array(z.string()).optional(),
  /** Skills that conflict with this one */
  conflictsWith: z.array(z.string()).optional(),
})

export type AgentverSkill = z.infer<typeof agentverSkillSchema>

// --- Validation result types ---

export type SkillValidationResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
  specCompliant: boolean
  agentverExtensions: string[]
  data?: AgentverSkill
  body?: string
}

// --- Parsing and validation functions ---

const AGENTVER_EXTENSION_FIELDS = [
  'version',
  'agentver-compatibility',
  'triggers',
  'extends',
  'dependsOn',
  'conflictsWith',
] as const

/**
 * Parse SKILL.md content and extract typed frontmatter + body.
 * Returns the full Agentver skill data (superset of Agent Skills spec).
 */
export function parseSkillFrontmatter(content: string): {
  frontmatter: AgentverSkill
  body: string
} {
  const { rawData, body, hasFrontmatter } = parseFrontmatter(content)

  if (!hasFrontmatter) {
    throw new Error('No YAML frontmatter found. Expected content delimited by --- markers.')
  }

  const parsed = agentverSkillSchema.safeParse(rawData)

  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    throw new Error(`Invalid SKILL.md frontmatter:\n${messages.join('\n')}`)
  }

  return { frontmatter: parsed.data, body }
}

/**
 * Validate a SKILL.md file against both the Agent Skills spec
 * and Agentver extensions. Returns detailed validation info.
 */
export function validateSkillMd(content: string): SkillValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const agentverExtensions: string[] = []

  const { rawData, body, hasFrontmatter } = parseFrontmatter(content)

  if (!hasFrontmatter) {
    return {
      valid: false,
      errors: ['No YAML frontmatter found. Expected content delimited by --- markers.'],
      warnings: [],
      specCompliant: false,
      agentverExtensions: [],
      body,
    }
  }

  // Check which Agentver extension fields are present
  for (const field of AGENTVER_EXTENSION_FIELDS) {
    if (field in rawData && rawData[field] !== undefined) {
      agentverExtensions.push(field)
    }
  }

  // Validate against the full Agentver schema (superset)
  const agentverParsed = agentverSkillSchema.safeParse(rawData)

  if (!agentverParsed.success) {
    const zodErrors = agentverParsed.error.issues.map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    return {
      valid: false,
      errors: zodErrors,
      warnings: [],
      specCompliant: false,
      agentverExtensions,
      body,
    }
  }

  // Check spec compliance (required fields present with correct constraints)
  const specCompliant = isAgentSkillsSpecCompliant(content)

  // Warnings for missing optional fields that improve discoverability
  if (!agentverParsed.data.license) {
    warnings.push(WARNING_NO_LICENCE)
  }

  if (!body || body.trim().length === 0) {
    warnings.push('SKILL.md body is empty. Add instructions for agents to follow.')
  }

  if (agentverParsed.data.description && agentverParsed.data.description.length < 20) {
    warnings.push(
      'Description is very short. Include what the skill does and when to use it for better discoverability.'
    )
  }

  return {
    valid: true,
    errors,
    warnings,
    specCompliant,
    agentverExtensions,
    data: agentverParsed.data,
    body,
  }
}

/**
 * Check whether a SKILL.md file is fully compliant with the
 * agentskills.io spec (ignoring Agentver extensions).
 */
export function isAgentSkillsSpecCompliant(content: string): boolean {
  const { rawData, hasFrontmatter } = parseFrontmatter(content)

  if (!hasFrontmatter) return false

  // Extract only spec-defined fields for validation
  const specFields: Record<string, unknown> = {}
  const specFieldNames = [
    'name',
    'description',
    'license',
    'compatibility',
    'metadata',
    'allowed-tools',
  ]

  for (const key of specFieldNames) {
    if (key in rawData) {
      specFields[key] = rawData[key]
    }
  }

  const parsed = agentSkillsSpecSchema.safeParse(specFields)
  return parsed.success
}

/**
 * Validate a skill name against the agentskills.io naming rules.
 * Useful for validating names independently of full SKILL.md parsing.
 */
export function validateSkillName(name: string): { valid: boolean; error?: string } {
  if (name.length < 1) {
    return { valid: false, error: 'Name must not be empty.' }
  }
  if (name.length > 64) {
    return { valid: false, error: `Name must be at most 64 characters (got ${name.length}).` }
  }
  if (name !== name.toLowerCase()) {
    return { valid: false, error: 'Name must be lowercase.' }
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    return { valid: false, error: 'Name must not start or end with a hyphen.' }
  }
  if (CONSECUTIVE_HYPHENS_REGEX.test(name)) {
    return { valid: false, error: 'Name must not contain consecutive hyphens.' }
  }
  if (!SKILL_NAME_REGEX.test(name)) {
    return {
      valid: false,
      error: 'Name must contain only lowercase alphanumeric characters and hyphens.',
    }
  }
  return { valid: true }
}
