import { describe, expect, it } from 'vitest'

import { getSpecComplianceLevel, parseFrontmatter, validateSkillFrontmatter } from '../validation'

describe('parseFrontmatter', () => {
  it('should return hasFrontmatter: false when no frontmatter present', () => {
    const result = parseFrontmatter('Just some plain text content')

    expect(result.hasFrontmatter).toBe(false)
    expect(result.rawData).toEqual({})
    expect(result.body).toBe('Just some plain text content')
  })

  it('should parse standard frontmatter delimited by ---', () => {
    const content = `---
name: my-skill
description: A test skill
---
Body content here`

    const result = parseFrontmatter(content)

    expect(result.hasFrontmatter).toBe(true)
    expect(result.rawData).toEqual({
      name: 'my-skill',
      description: 'A test skill',
    })
  })

  it('should handle Windows line endings (\\r\\n)', () => {
    const content = '---\r\nname: my-skill\r\ndescription: A test skill\r\n---\r\nBody content'

    const result = parseFrontmatter(content)

    expect(result.hasFrontmatter).toBe(true)
    expect(result.rawData).toEqual({
      name: 'my-skill',
      description: 'A test skill',
    })
  })

  it('should handle empty frontmatter (--- then ---)', () => {
    const content = `---

---
Body after empty frontmatter`

    const result = parseFrontmatter(content)

    expect(result.hasFrontmatter).toBe(true)
    expect(result.rawData).toEqual({})
  })

  it('should return body after frontmatter', () => {
    const content = `---
name: test
---
This is the body content.
It has multiple lines.`

    const result = parseFrontmatter(content)

    expect(result.body).toBe('This is the body content.\nIt has multiple lines.')
  })

  it('should handle empty body after frontmatter', () => {
    const content = `---
name: test
---`

    const result = parseFrontmatter(content)

    expect(result.hasFrontmatter).toBe(true)
    expect(result.body).toBe('')
  })

  it('should only match first --- pair', () => {
    const content = `---
name: first
---
Some body
---
name: second
---`

    const result = parseFrontmatter(content)

    expect(result.hasFrontmatter).toBe(true)
    expect(result.rawData).toEqual({ name: 'first' })
    expect(result.body).toContain('Some body')
  })

  it('should return full content as body when no frontmatter', () => {
    const content = 'No frontmatter here\nJust plain text'

    const result = parseFrontmatter(content)

    expect(result.hasFrontmatter).toBe(false)
    expect(result.body).toBe(content)
  })

  it('should parse simple key-value pairs', () => {
    const content = `---
name: my-skill
version: 1.0.0
license: MIT
---`

    const result = parseFrontmatter(content)

    expect(result.rawData).toEqual({
      name: 'my-skill',
      version: '1.0.0',
      license: 'MIT',
    })
  })

  it('should parse inline arrays [a, b, c]', () => {
    const content = `---
name: test
compatibility: [claude-code, cursor, windsurf]
---`

    const result = parseFrontmatter(content)

    expect(result.rawData).toEqual({
      name: 'test',
      compatibility: ['claude-code', 'cursor', 'windsurf'],
    })
  })

  it('should parse multiline arrays with - item syntax', () => {
    const content = `---
name: test
compatibility:
  - claude-code
  - cursor
  - windsurf
---`

    const result = parseFrontmatter(content)

    expect(result.rawData).toEqual({
      name: 'test',
      compatibility: ['claude-code', 'cursor', 'windsurf'],
    })
  })

  it('should parse boolean values (true/false)', () => {
    const content = `---
name: test
enabled: true
disabled: false
---`

    const result = parseFrontmatter(content)

    expect(result.rawData).toEqual({
      name: 'test',
      enabled: true,
      disabled: false,
    })
  })

  it('should parse numeric values (integer and float)', () => {
    const content = `---
name: test
count: 42
ratio: 3.14
---`

    const result = parseFrontmatter(content)

    expect(result.rawData).toEqual({
      name: 'test',
      count: 42,
      ratio: 3.14,
    })
  })

  it('should strip quotes from quoted strings', () => {
    const content = `---
name: "my-skill"
description: 'A quoted description'
---`

    const result = parseFrontmatter(content)

    expect(result.rawData).toEqual({
      name: 'my-skill',
      description: 'A quoted description',
    })
  })

  it('should skip comment lines (# comment)', () => {
    const content = `---
# This is a comment
name: test
# Another comment
description: A skill
---`

    const result = parseFrontmatter(content)

    expect(result.rawData).toEqual({
      name: 'test',
      description: 'A skill',
    })
  })

  it('should handle keys with colons in values', () => {
    const content = `---
name: test
description: This has a colon: right here
---`

    const result = parseFrontmatter(content)

    expect(result.rawData).toEqual({
      name: 'test',
      description: 'This has a colon: right here',
    })
  })

  it('should parse nested records', () => {
    const content = `---
name: test
metadata:
  author: someone
  category: testing
---`

    const result = parseFrontmatter(content)

    expect(result.rawData).toEqual({
      name: 'test',
      metadata: {
        author: 'someone',
        category: 'testing',
      },
    })
  })
})

describe('validateSkillFrontmatter', () => {
  it('should return valid: false when no frontmatter found', () => {
    const result = validateSkillFrontmatter('No frontmatter here')

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'No YAML frontmatter found. Expected content delimited by --- markers.'
    )
  })

  it('should return valid: true for minimal valid frontmatter', () => {
    const content = `---
name: my-skill
description: A valid skill
---
Body content`

    const result = validateSkillFrontmatter(content)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('should return valid: true with all optional fields', () => {
    const content = `---
name: my-skill
description: A fully specified skill
version: 1.2.3
license: MIT
compatibility: [claude-code, cursor]
allowed-tools: [Read, Write, Bash]
metadata:
  author: tester
  category: utilities
---
Full body content`

    const result = validateSkillFrontmatter(content)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('should return Zod validation errors for missing required fields', () => {
    const content = `---
version: 1.0.0
---`

    const result = validateSkillFrontmatter(content)

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should add warning for missing licence field', () => {
    const content = `---
name: my-skill
description: A skill without licence
compatibility: [claude-code]
allowed-tools: [Read]
---`

    const result = validateSkillFrontmatter(content)

    expect(result.warnings).toContain(
      'No licence specified. Consider adding an SPDX licence identifier.'
    )
  })

  it('should add warning for missing compatibility array', () => {
    const content = `---
name: my-skill
description: A skill without compatibility
license: MIT
allowed-tools: [Read]
---`

    const result = validateSkillFrontmatter(content)

    expect(result.warnings).toContain(
      'No compatibility agents listed. Consider adding agents like claude-code, cursor, etc.'
    )
  })

  it('should add warning for missing allowed-tools', () => {
    const content = `---
name: my-skill
description: A skill without allowed-tools
license: MIT
compatibility: [claude-code]
---`

    const result = validateSkillFrontmatter(content)

    expect(result.warnings).toContain(
      'No allowed-tools specified. Consider listing tools this skill requires.'
    )
  })

  it('should accept compatibility as a comma-separated string', () => {
    const content = `---
name: my-skill
description: A skill with string compatibility
license: MIT
compatibility: claude-code, cursor
allowed-tools: [Read]
---`

    const result = validateSkillFrontmatter(content)

    expect(result.valid).toBe(true)
    expect(result.data?.compatibility).toEqual(['claude-code', 'cursor'])
  })

  it('should accept allowed-tools as a space-separated string', () => {
    const content = `---
name: my-skill
description: A skill with string allowed-tools
license: MIT
compatibility: [claude-code]
allowed-tools: Read Write Bash
---`

    const result = validateSkillFrontmatter(content)

    expect(result.valid).toBe(true)
    expect(result.data?.['allowed-tools']).toEqual(['Read', 'Write', 'Bash'])
  })

  it('should return parsed data and body when valid', () => {
    const content = `---
name: my-skill
description: A valid skill
version: 1.0.0
---
The skill body content goes here.`

    const result = validateSkillFrontmatter(content)

    expect(result.valid).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data?.name).toBe('my-skill')
    expect(result.data?.description).toBe('A valid skill')
    expect(result.body).toBe('The skill body content goes here.')
  })
})

describe('getSpecComplianceLevel', () => {
  it('should return "none" when no frontmatter present', () => {
    const result = getSpecComplianceLevel('Just plain text, no frontmatter')

    expect(result).toBe('none')
  })

  it('should return "partial" when frontmatter fails validation', () => {
    const content = `---
version: 1.0.0
---
Body content`

    const result = getSpecComplianceLevel(content)

    expect(result).toBe('partial')
  })

  it('should return "compliant" when frontmatter is fully valid', () => {
    const content = `---
name: my-skill
description: A fully valid skill
version: 1.0.0
---
Body content`

    const result = getSpecComplianceLevel(content)

    expect(result).toBe('compliant')
  })
})
