import type { ZodIssue } from 'zod'
import { WARNING_NO_LICENCE } from './constants'
import { type SkillFrontmatter, skillFrontmatterSchema } from './schemas'

// --- Frontmatter validation result ---

export type FrontmatterValidationResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
  data?: SkillFrontmatter
  body?: string
}

export type SpecComplianceLevel = 'compliant' | 'partial' | 'none'

// --- Simple YAML frontmatter parser (no external dependency) ---

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/

function flushBlockScalar(lines: string[], style: '|' | '>'): string {
  // Strip trailing empty lines
  const trimmed = [...lines]
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') {
    trimmed.pop()
  }

  if (style === '|') {
    return trimmed.join('\n')
  }

  // Folded style: single line breaks become spaces, but blank lines and
  // more-indented lines preserve line breaks.
  const parts: string[] = []
  let current: string[] = []

  const flushCurrent = () => {
    if (current.length > 0) {
      parts.push(current.join(' '))
      current = []
    }
  }

  for (const line of trimmed) {
    if (line === '') {
      flushCurrent()
      parts.push('')
      continue
    }

    if (/^ /.test(line)) {
      flushCurrent()
      parts.push(line)
      continue
    }

    current.push(line)
  }
  flushCurrent()
  return parts.join('\n')
}

/**
 * Parse a simple YAML key-value block.
 * Supports: strings, arrays (inline `[a, b]` and multiline `- item`),
 * and records (`key: value` nested under a parent).
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = yaml.split(/\r?\n/)

  let currentKey: string | null = null
  let currentArray: string[] | null = null
  let currentRecord: Record<string, string> | null = null
  let currentBlockScalarLines: string[] | null = null
  let currentBlockScalarStyle: '|' | '>' | null = null
  let currentBlockScalarIndent: number | null = null

  for (const line of lines) {
    // Block scalar continuation must be checked before comment/empty skipping
    // because indented # lines and blank lines are valid content inside block scalars
    if (currentKey && currentBlockScalarLines !== null) {
      if (line.trim() === '') {
        currentBlockScalarLines.push('')
        continue
      }
      if (/^\s+/.test(line)) {
        if (currentBlockScalarIndent === null) {
          currentBlockScalarIndent = line.match(/^(\s+)/)![1]!.length
        }
        currentBlockScalarLines.push(line.slice(currentBlockScalarIndent))
        continue
      }
      // Non-indented line — flush the block scalar
      result[currentKey] = flushBlockScalar(currentBlockScalarLines, currentBlockScalarStyle!)
      currentKey = null
      currentBlockScalarLines = null
      currentBlockScalarStyle = null
      currentBlockScalarIndent = null
      // Fall through to process current line as a new key
    }

    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue
    }

    // Array item continuation (e.g. `  - value`)
    const arrayItemMatch = line.match(/^ +- +(\S.*)$/)
    if (arrayItemMatch && currentKey && currentArray) {
      currentArray.push(arrayItemMatch[1]!.trim().replace(/^['"]|['"]$/g, ''))
      continue
    }

    // Record item continuation (e.g. `  subkey: value`)
    const recordItemMatch = line.match(/^ +(\S+): +(\S.*)$/)
    if (recordItemMatch && currentKey && currentRecord) {
      currentRecord[recordItemMatch[1]!] = recordItemMatch[2]!.trim().replace(/^['"]|['"]$/g, '')
      continue
    }

    // If we were collecting an array or record, flush it (prefer record if it has entries)
    if (currentKey) {
      if (currentRecord && Object.keys(currentRecord).length > 0) {
        result[currentKey] = currentRecord
      } else if (currentArray !== null) {
        result[currentKey] = currentArray
      }
      currentArray = null
      currentRecord = null
      currentKey = null
    }

    // Top-level key: value
    const kvMatch = line.match(/^([a-zA-Z0-9_-]+):(.*)$/)
    if (!kvMatch) continue

    const key = kvMatch[1]!
    const rawValue = kvMatch[2]!.trim()

    // Empty value — could be start of array or record block
    if (rawValue === '') {
      currentKey = key
      currentArray = []
      currentRecord = {}
      continue
    }

    // Block scalar indicators: | (literal) or > (folded)
    if (rawValue === '|' || rawValue === '>') {
      currentKey = key
      currentBlockScalarStyle = rawValue
      currentBlockScalarLines = []
      currentBlockScalarIndent = null
      continue
    }

    // Inline array: [a, b, c] or []
    const inlineArrayMatch = rawValue.match(/^\[(.*)\]$/)
    if (inlineArrayMatch) {
      const inner = inlineArrayMatch[1]!.trim()
      result[key] =
        inner === '' ? [] : inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      continue
    }

    // Boolean
    if (rawValue === 'true' || rawValue === 'false') {
      result[key] = rawValue === 'true'
      continue
    }

    // Number (integers only — decimals like 1.0 stay as strings to avoid lossy coercion)
    if (/^\d+$/.test(rawValue)) {
      result[key] = Number(rawValue)
      continue
    }

    // String (strip quotes if present)
    result[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }

  // Flush any trailing block scalar
  if (currentKey && currentBlockScalarLines !== null) {
    result[currentKey] = flushBlockScalar(currentBlockScalarLines, currentBlockScalarStyle!)
  } else if (currentKey) {
    if (currentRecord && Object.keys(currentRecord).length > 0) {
      result[currentKey] = currentRecord
    } else if (currentArray !== null) {
      result[currentKey] = currentArray
    }
  }

  return result
}

/**
 * Extract YAML frontmatter and markdown body from a SKILL.md string.
 */
export function parseFrontmatter(content: string): {
  rawData: Record<string, unknown>
  body: string
  hasFrontmatter: boolean
} {
  const match = content.match(FRONTMATTER_REGEX)

  if (!match) {
    return { rawData: {}, body: content.trim(), hasFrontmatter: false }
  }

  const yamlBlock = match[1] ?? ''
  const afterFrontmatter = content.slice(match[0].length)

  return {
    rawData: parseSimpleYaml(yamlBlock),
    body: afterFrontmatter.trim(),
    hasFrontmatter: true,
  }
}

/**
 * Validate a SKILL.md file's frontmatter against the spec.
 *
 * Returns structured validation info including compliance level,
 * errors, warnings, and parsed data.
 */
export function validateSkillFrontmatter(content: string): FrontmatterValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const { rawData, body, hasFrontmatter } = parseFrontmatter(content)

  if (!hasFrontmatter) {
    return {
      valid: false,
      errors: ['No YAML frontmatter found. Expected content delimited by --- markers.'],
      warnings: [],
      body,
    }
  }

  const parsed = skillFrontmatterSchema.safeParse(rawData)

  if (!parsed.success) {
    const zodErrors = parsed.error.issues.map((issue: ZodIssue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    return {
      valid: false,
      errors: zodErrors,
      warnings: [],
      body,
    }
  }

  // Valid but check for optional fields that improve discoverability
  if (!parsed.data.license) {
    warnings.push(WARNING_NO_LICENCE)
  }

  if (!parsed.data.compatibility || parsed.data.compatibility.length === 0) {
    warnings.push(
      'No compatibility agents listed. Consider adding agents like claude-code, cursor, etc.'
    )
  }

  if (!parsed.data['allowed-tools'] || parsed.data['allowed-tools'].length === 0) {
    warnings.push('No allowed-tools specified. Consider listing tools this skill requires.')
  }

  return {
    valid: true,
    errors,
    warnings,
    data: parsed.data,
    body,
  }
}

/**
 * Determine the spec compliance level from a validation result.
 */
export function getSpecComplianceLevel(content: string): SpecComplianceLevel {
  const { hasFrontmatter, rawData } = parseFrontmatter(content)

  if (!hasFrontmatter) {
    return 'none'
  }

  const parsed = skillFrontmatterSchema.safeParse(rawData)

  if (!parsed.success) {
    // Has frontmatter but doesn't fully validate
    return 'partial'
  }

  return 'compliant'
}
