/**
 * E2E tests for the init and validate commands.
 *
 * init  — scaffolds a new skill project with SKILL.md and supporting directories.
 * validate — validates a SKILL.md file against the agentskills.io spec and Agentver extensions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withTempDir } from '../helpers/mock-fs'
import { runCliJson } from './helpers'

// ---------------------------------------------------------------------------
// Types for JSON output
// ---------------------------------------------------------------------------

type InitResult = {
  name: string
  type: string
  path: string
  files: string[]
}

type ValidateResult = {
  path: string
  valid: boolean
  specCompliant: boolean
  errors: string[]
  warnings: string[]
  agentverExtensions: string[]
}

// ---------------------------------------------------------------------------
// init command
// ---------------------------------------------------------------------------

describe('E2E: init command', () => {
  it('creates a skill project with SKILL.md', async () => {
    await withTempDir(async (dir) => {
      const { data, success, exitCode } = await runCliJson<InitResult>(
        ['init', '--name', 'my-test-skill', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.name).toBe('my-test-skill')
      expect(data.type).toBe('skill')
      expect(data.files).toContain('SKILL.md')

      const skillMdPath = join(dir, 'my-test-skill', 'SKILL.md')
      expect(existsSync(skillMdPath)).toBe(true)

      const content = readFileSync(skillMdPath, 'utf-8')
      expect(content).toContain('---')
      expect(content).toContain('name: my-test-skill')
      expect(content).toContain('description:')
    })
  })

  it('creates correct frontmatter structure', async () => {
    await withTempDir(async (dir) => {
      const { data, exitCode } = await runCliJson<InitResult>(
        ['init', '--name', 'another-skill', '--description', 'A skill for testing', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)

      const skillMdPath = join(dir, 'another-skill', 'SKILL.md')
      const content = readFileSync(skillMdPath, 'utf-8')

      // Frontmatter delimiters
      const frontmatterMatches = content.match(/^---/gm)
      expect(frontmatterMatches).not.toBeNull()
      expect(frontmatterMatches!.length).toBeGreaterThanOrEqual(2)

      // Required fields
      expect(content).toContain('name: another-skill')
      expect(content).toContain('description: A skill for testing')
      expect(content).toContain('version: 0.1.0')

      // Supporting directories
      expect(data.files).toContain('examples/README.md')
      expect(data.files).toContain('docs/README.md')
      expect(existsSync(join(dir, 'another-skill', 'examples'))).toBe(true)
      expect(existsSync(join(dir, 'another-skill', 'docs'))).toBe(true)
    })
  })

  it('creates skill inside a new directory even when cwd is empty', async () => {
    await withTempDir(async (dir) => {
      const { data, exitCode } = await runCliJson<InitResult>(
        ['init', '--name', 'empty-dir-skill', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(data.path).toContain('empty-dir-skill')

      const skillDir = join(dir, 'empty-dir-skill')
      expect(existsSync(skillDir)).toBe(true)
      expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
    })
  })

  it('refuses to overwrite an existing directory', async () => {
    await withTempDir(async (dir) => {
      // Create the directory first
      const existingDir = join(dir, 'existing-skill')
      mkdirSync(existingDir, { recursive: true })
      writeFileSync(join(existingDir, 'SKILL.md'), '# Pre-existing content\n')

      const { success, exitCode } = await runCliJson<InitResult>(
        ['init', '--name', 'existing-skill', '--json'],
        { cwd: dir }
      )

      expect(success).toBe(false)
      expect(exitCode).not.toBe(0)

      // Original file must be untouched
      const content = readFileSync(join(existingDir, 'SKILL.md'), 'utf-8')
      expect(content).toBe('# Pre-existing content\n')
    })
  })

  it('creates a repo-structured project with --repo flag', async () => {
    await withTempDir(async (dir) => {
      const { data, exitCode } = await runCliJson<InitResult>(
        ['init', '--name', 'repo-skill', '--repo', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(data.files).toContain('skills/example-skill/SKILL.md')
      expect(data.files).toContain('README.md')
      expect(data.files).toContain('.agentverignore')
      expect(data.files).toContain('configs/.gitkeep')
      expect(data.files).toContain('prompts/.gitkeep')

      const repoDir = join(dir, 'repo-skill')
      expect(existsSync(join(repoDir, 'skills', 'example-skill', 'SKILL.md'))).toBe(true)
      expect(existsSync(join(repoDir, 'README.md'))).toBe(true)
    })
  })

  it('rejects an invalid skill name', async () => {
    await withTempDir(async (dir) => {
      const { success, exitCode } = await runCliJson<InitResult>(
        ['init', '--name', 'INVALID_NAME', '--json'],
        { cwd: dir }
      )

      expect(success).toBe(false)
      expect(exitCode).not.toBe(0)
    })
  })

  it('scaffolds a prompt type with PROMPT.md', async () => {
    await withTempDir(async (dir) => {
      const { data, exitCode } = await runCliJson<InitResult>(
        ['init', '--type', 'prompt', '--name', 'my-prompt', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(data.type).toBe('prompt')
      expect(data.files).toContain('PROMPT.md')

      const promptPath = join(dir, 'my-prompt', 'PROMPT.md')
      expect(existsSync(promptPath)).toBe(true)

      const content = readFileSync(promptPath, 'utf-8')
      expect(content).toContain('name: my-prompt')
    })
  })
})

// ---------------------------------------------------------------------------
// validate command
// ---------------------------------------------------------------------------

describe('E2E: validate command', () => {
  it('passes on a valid SKILL.md', async () => {
    await withTempDir(async (dir) => {
      const skillMd = [
        '---',
        'name: valid-skill',
        'description: A perfectly valid skill for testing validation',
        'version: 1.0.0',
        '---',
        '',
        '# Valid Skill',
        '',
        'Instructions for the agent.',
        '',
      ].join('\n')

      writeFileSync(join(dir, 'SKILL.md'), skillMd)

      const { data, success, exitCode } = await runCliJson<ValidateResult>(['validate', '--json'], {
        cwd: dir,
      })

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.valid).toBe(true)
      expect(data.errors).toHaveLength(0)
    })
  })

  it('fails when SKILL.md is missing', async () => {
    await withTempDir(async (dir) => {
      const { success, exitCode } = await runCliJson<ValidateResult>(['validate', '--json'], {
        cwd: dir,
      })

      expect(success).toBe(false)
      expect(exitCode).not.toBe(0)
    })
  })

  it('fails on SKILL.md missing required name field', async () => {
    await withTempDir(async (dir) => {
      const skillMd = [
        '---',
        'description: A skill without a name',
        'version: 1.0.0',
        '---',
        '',
        '# Nameless',
        '',
      ].join('\n')

      writeFileSync(join(dir, 'SKILL.md'), skillMd)

      const { data, success, exitCode } = await runCliJson<ValidateResult>(['validate', '--json'], {
        cwd: dir,
      })

      expect(success).toBe(true) // outputSuccess is always called when the file exists
      expect(exitCode).not.toBe(0) // but exit code is 1 when invalid
      expect(data.valid).toBe(false)
      expect(data.errors.length).toBeGreaterThan(0)
      expect(
        data.errors.some((e) => e.toLowerCase().includes('name') || e.includes('Required'))
      ).toBe(true)
    })
  })

  it('fails on an empty file', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'SKILL.md'), '')

      const { data, success, exitCode } = await runCliJson<ValidateResult>(['validate', '--json'], {
        cwd: dir,
      })

      expect(success).toBe(true) // outputSuccess is called
      expect(exitCode).not.toBe(0) // exit 1 because !result.valid
      expect(data.valid).toBe(false)
      expect(data.errors.length).toBeGreaterThan(0)
    })
  })

  it('accepts SKILL.md in a subdirectory via path argument', async () => {
    await withTempDir(async (dir) => {
      const subDir = join(dir, 'subdir')
      mkdirSync(subDir, { recursive: true })

      const skillMd = [
        '---',
        'name: sub-skill',
        'description: A skill in a subdirectory for path resolution testing',
        'version: 1.0.0',
        '---',
        '',
        '# Sub Skill',
        '',
        'Instructions.',
        '',
      ].join('\n')

      writeFileSync(join(subDir, 'SKILL.md'), skillMd)

      const { data, success, exitCode } = await runCliJson<ValidateResult>(
        ['validate', 'subdir', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(success).toBe(true)
      expect(data.valid).toBe(true)
      expect(data.path).toContain('subdir')
    })
  })

  it('accepts a direct file path to SKILL.md', async () => {
    await withTempDir(async (dir) => {
      const subDir = join(dir, 'nested')
      mkdirSync(subDir, { recursive: true })

      const skillMd = [
        '---',
        'name: direct-path-skill',
        'description: Testing direct file path argument to validate',
        'version: 2.0.0',
        '---',
        '',
        '# Direct Path Skill',
        '',
        'Instructions.',
        '',
      ].join('\n')

      writeFileSync(join(subDir, 'SKILL.md'), skillMd)

      const { data, exitCode } = await runCliJson<ValidateResult>(
        ['validate', 'nested/SKILL.md', '--json'],
        { cwd: dir }
      )

      expect(exitCode).toBe(0)
      expect(data.valid).toBe(true)
    })
  })

  it('reports agentver extensions when present', async () => {
    await withTempDir(async (dir) => {
      const skillMd = [
        '---',
        'name: extended-skill',
        'description: A skill with agentver-specific extensions for testing',
        'version: 1.0.0',
        'triggers:',
        '  - Use when testing extension detection',
        'dependsOn:',
        '  - base-skill',
        '---',
        '',
        '# Extended Skill',
        '',
        'Instructions.',
        '',
      ].join('\n')

      writeFileSync(join(dir, 'SKILL.md'), skillMd)

      const { data, exitCode } = await runCliJson<ValidateResult>(['validate', '--json'], {
        cwd: dir,
      })

      expect(exitCode).toBe(0)
      expect(data.valid).toBe(true)
      expect(data.agentverExtensions).toContain('version')
      expect(data.agentverExtensions).toContain('triggers')
      expect(data.agentverExtensions).toContain('dependsOn')
    })
  })

  it('validates a SKILL.md created by the init command', async () => {
    await withTempDir(async (dir) => {
      // Scaffold via init
      const { exitCode: initExit } = await runCliJson<InitResult>(
        [
          'init',
          '--name',
          'roundtrip-skill',
          '--description',
          'Roundtrip validation test',
          '--json',
        ],
        { cwd: dir }
      )
      expect(initExit).toBe(0)

      // Validate the generated SKILL.md
      const skillDir = join(dir, 'roundtrip-skill')
      const { data, exitCode } = await runCliJson<ValidateResult>(['validate', '--json'], {
        cwd: skillDir,
      })

      expect(exitCode).toBe(0)
      expect(data.valid).toBe(true)
      expect(data.errors).toHaveLength(0)
    })
  })

  it('fails on SKILL.md with missing description field', async () => {
    await withTempDir(async (dir) => {
      const skillMd = [
        '---',
        'name: no-desc-skill',
        'version: 1.0.0',
        '---',
        '',
        '# No Description',
        '',
      ].join('\n')

      writeFileSync(join(dir, 'SKILL.md'), skillMd)

      const { data, exitCode } = await runCliJson<ValidateResult>(['validate', '--json'], {
        cwd: dir,
      })

      expect(exitCode).not.toBe(0)
      expect(data.valid).toBe(false)
      expect(data.errors.length).toBeGreaterThan(0)
    })
  })
})
