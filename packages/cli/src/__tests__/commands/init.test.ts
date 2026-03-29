import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCLIOutputSchema, initResultSchema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any import of the SUT
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('prompts', () => ({ default: vi.fn() }))

vi.mock('../../output.js', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { Command } from 'commander'
import prompts from 'prompts'
import { registerInitCommand } from '../../commands/init'
import * as outputModule from '../../output.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The init command reads `--json` from process.argv via isJSONMode(),
 * not from Commander options. We must NOT pass --json through Commander
 * (which would reject it as unknown), but set process.argv so
 * isJSONMode() returns true.
 */
function createProgram(): Command {
  const program = new Command()
  program.exitOverride()
  // Allow unknown options so --json doesn't fail at the Commander level
  program.allowUnknownOption(true)
  registerInitCommand(program)
  return program
}

async function runInit(args: string[]): Promise<void> {
  const program = createProgram()
  try {
    await program.parseAsync(['node', 'agentver', ...args])
  } catch {
    // Catch CommanderError from exitOverride when process.exit is called
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commands/init', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn().mockReturnValue('/project')
    process.argv = ['node', 'agentver', 'init']
    process.exit = vi.fn() as never
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
    vi.mocked(existsSync).mockReturnValue(false)
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
  })

  // -------------------------------------------------------------------------
  // 1. Skill type
  // -------------------------------------------------------------------------

  describe('skill type', () => {
    it('creates directory with SKILL.md containing correct frontmatter', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'my-skill', '--type', 'skill'])

      expect(mkdirSync).toHaveBeenCalledWith(join('/project', 'my-skill'), { recursive: true })

      const writeFileCalls = vi.mocked(writeFileSync).mock.calls
      const skillMdCall = writeFileCalls.find((call) => String(call[0]).endsWith('SKILL.md'))
      expect(skillMdCall).toBeDefined()

      const content = skillMdCall![1] as string
      expect(content).toContain('name: my-skill')
    })
  })

  // -------------------------------------------------------------------------
  // 2. Plugin type
  // -------------------------------------------------------------------------

  describe('plugin type', () => {
    it('creates directory with plugin.json', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'my-plugin', '--type', 'plugin'])

      const writeFileCalls = vi.mocked(writeFileSync).mock.calls
      const pluginJsonCall = writeFileCalls.find((call) => String(call[0]).endsWith('plugin.json'))
      expect(pluginJsonCall).toBeDefined()

      const content = pluginJsonCall![1] as string
      const parsed = JSON.parse(content) as Record<string, unknown>
      expect(parsed.name).toBe('my-plugin')
    })
  })

  // -------------------------------------------------------------------------
  // 3. Agent type
  // -------------------------------------------------------------------------

  describe('agent type', () => {
    it('creates directory with CLAUDE.md config file', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'my-agent', '--type', 'agent'])

      const writeFileCalls = vi.mocked(writeFileSync).mock.calls
      const claudeMdCall = writeFileCalls.find((call) => String(call[0]).endsWith('CLAUDE.md'))
      expect(claudeMdCall).toBeDefined()

      const content = claudeMdCall![1] as string
      expect(content).toContain('my-agent')
    })
  })

  // -------------------------------------------------------------------------
  // 4. Script type
  // -------------------------------------------------------------------------

  describe('script type', () => {
    it('creates directory with script.json and src/index.ts', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'my-script', '--type', 'script'])

      const writeFileCalls = vi.mocked(writeFileSync).mock.calls
      const scriptJsonCall = writeFileCalls.find((call) => String(call[0]).endsWith('script.json'))
      expect(scriptJsonCall).toBeDefined()

      const indexTsCall = writeFileCalls.find((call) => String(call[0]).endsWith('index.ts'))
      expect(indexTsCall).toBeDefined()

      const content = scriptJsonCall![1] as string
      const parsed = JSON.parse(content) as Record<string, unknown>
      expect(parsed.name).toBe('my-script')
      expect(parsed.entryPoint).toBe('src/index.ts')
    })
  })

  // -------------------------------------------------------------------------
  // 5. Prompt type
  // -------------------------------------------------------------------------

  describe('prompt type', () => {
    it('creates directory with PROMPT.md', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'my-prompt', '--type', 'prompt'])

      const writeFileCalls = vi.mocked(writeFileSync).mock.calls
      const promptMdCall = writeFileCalls.find((call) => String(call[0]).endsWith('PROMPT.md'))
      expect(promptMdCall).toBeDefined()

      const content = promptMdCall![1] as string
      expect(content).toContain('name: my-prompt')
    })
  })

  // -------------------------------------------------------------------------
  // 6. Sub-agent type
  // -------------------------------------------------------------------------

  describe('sub-agent type', () => {
    it('creates directory with AGENT.md containing correct frontmatter', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'my-sub-agent', '--type', 'sub-agent'])

      const writeFileCalls = vi.mocked(writeFileSync).mock.calls
      const agentMdCall = writeFileCalls.find((call) => String(call[0]).endsWith('AGENT.md'))
      expect(agentMdCall).toBeDefined()

      const content = agentMdCall![1] as string
      expect(content).toContain('name: my-sub-agent')
      expect(content).toContain('compatibility:')
    })
  })

  // -------------------------------------------------------------------------
  // 7. Command type
  // -------------------------------------------------------------------------

  describe('command type', () => {
    it('creates directory with COMMAND.md containing correct frontmatter', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'my-command', '--type', 'command'])

      const writeFileCalls = vi.mocked(writeFileSync).mock.calls
      const commandMdCall = writeFileCalls.find((call) => String(call[0]).endsWith('COMMAND.md'))
      expect(commandMdCall).toBeDefined()

      const content = commandMdCall![1] as string
      expect(content).toContain('name: my-command')
    })
  })

  // -------------------------------------------------------------------------
  // 8. Bundle type
  // -------------------------------------------------------------------------

  describe('bundle type', () => {
    it('creates directory with agentver.bundle.yaml', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'my-bundle', '--type', 'bundle'])

      const writeFileCalls = vi.mocked(writeFileSync).mock.calls
      const bundleCall = writeFileCalls.find((call) =>
        String(call[0]).endsWith('agentver.bundle.yaml')
      )
      expect(bundleCall).toBeDefined()

      const content = bundleCall![1] as string
      expect(content).toContain('name: my-bundle')
      expect(content).toContain('includes:')
    })

    it('creates skills/ and prompts/ subdirectories when not in repo mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'my-bundle', '--type', 'bundle'])

      const mkdirCalls = vi.mocked(mkdirSync).mock.calls
      const createdDirs = mkdirCalls.map((call) => String(call[0]))
      expect(createdDirs.some((d) => d.endsWith(join('my-bundle', 'skills')))).toBe(true)
      expect(createdDirs.some((d) => d.endsWith(join('my-bundle', 'prompts')))).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // 9. --name flag
  // -------------------------------------------------------------------------

  describe('--name flag', () => {
    it('uses the provided name in generated file frontmatter', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'custom-skill-name', '--type', 'skill'])

      const writeFileCalls = vi.mocked(writeFileSync).mock.calls
      const skillMdCall = writeFileCalls.find((call) => String(call[0]).endsWith('SKILL.md'))
      expect(skillMdCall).toBeDefined()

      const content = skillMdCall![1] as string
      expect(content).toContain('name: custom-skill-name')
    })
  })

  // -------------------------------------------------------------------------
  // 10. --description flag
  // -------------------------------------------------------------------------

  describe('--description flag', () => {
    it('includes description in the generated frontmatter', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit([
        'init',
        '--name',
        'my-skill',
        '--description',
        'A test description',
        '--type',
        'skill',
      ])

      const writeFileCalls = vi.mocked(writeFileSync).mock.calls
      const skillMdCall = writeFileCalls.find((call) => String(call[0]).endsWith('SKILL.md'))
      expect(skillMdCall).toBeDefined()

      const content = skillMdCall![1] as string
      expect(content).toContain('description: A test description')
    })
  })

  // -------------------------------------------------------------------------
  // 11. --repo flag
  // -------------------------------------------------------------------------

  describe('--repo flag', () => {
    it('creates repo structure with skills/, configs/, prompts/', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'my-repo', '--type', 'skill', '--repo'])

      const writeFileCalls = vi.mocked(writeFileSync).mock.calls

      // Should create .agentverignore
      const agentverignoreCall = writeFileCalls.find((call) =>
        String(call[0]).endsWith('.agentverignore')
      )
      expect(agentverignoreCall).toBeDefined()

      // Should create README.md
      const readmeCall = writeFileCalls.find((call) =>
        String(call[0]).endsWith(join('my-repo', 'README.md'))
      )
      expect(readmeCall).toBeDefined()

      // Should create skills/example-skill/SKILL.md
      const exampleSkillCall = writeFileCalls.find((call) =>
        String(call[0]).includes(join('skills', 'example-skill', 'SKILL.md'))
      )
      expect(exampleSkillCall).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // 12. --json output validates against initResultSchema
  // -------------------------------------------------------------------------

  describe('--json output', () => {
    it('calls outputSuccess with data matching initResultSchema', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'my-skill', '--type', 'skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const envelope = { success: true, data }
      const outputSchema = createCLIOutputSchema(initResultSchema)
      const result = outputSchema.safeParse(envelope)
      expect(result.success).toBe(true)
    })

    it('includes correct name, type, and files in JSON output', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'test-pkg', '--type', 'plugin'])

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.name).toBe('test-pkg')
      expect(typed.type).toBe('plugin')
      expect(typed.path).toBe(join('/project', 'test-pkg'))
      expect(typed.files).toContain('plugin.json')
    })

    it('includes correct type for sub-agent in JSON output', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'test-sub-agent', '--type', 'sub-agent'])

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.type).toBe('sub-agent')
      expect(typed.files).toContain('AGENT.md')
    })

    it('includes correct type for command in JSON output', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'test-command', '--type', 'command'])

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.type).toBe('command')
      expect(typed.files).toContain('COMMAND.md')
    })

    it('includes correct type for bundle in JSON output', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'test-bundle', '--type', 'bundle'])

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.type).toBe('bundle')
      expect(typed.files).toContain('agentver.bundle.yaml')
    })
  })

  // -------------------------------------------------------------------------
  // 13. Directory already exists
  // -------------------------------------------------------------------------

  describe('directory already exists', () => {
    it('calls process.exit with ALREADY_EXISTS error in JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']
      vi.mocked(existsSync).mockReturnValue(true)

      await runInit(['init', '--name', 'existing-pkg', '--type', 'skill'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'ALREADY_EXISTS',
        expect.stringContaining('already exists')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('calls process.exit in non-JSON mode when directory exists', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      // Must provide --name to skip prompts in non-JSON mode
      // The prompts mock needs to return a valid response
      vi.mocked(prompts).mockResolvedValue({ name: 'existing-pkg', description: '' })

      await runInit(['init', '--name', 'existing-pkg', '--type', 'agent'])

      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // 14. Generated SKILL.md contains valid structure
  // -------------------------------------------------------------------------

  describe('generated SKILL.md structure', () => {
    it('has valid YAML frontmatter between --- delimiters', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'valid-skill', '--type', 'skill'])

      const writeFileCalls = vi.mocked(writeFileSync).mock.calls
      const skillMdCall = writeFileCalls.find((call) => String(call[0]).endsWith('SKILL.md'))
      expect(skillMdCall).toBeDefined()

      const content = skillMdCall![1] as string
      const parts = content.split('---')
      // Should have at least 3 parts: before, frontmatter, after
      expect(parts.length).toBeGreaterThanOrEqual(3)

      const frontmatter = parts[1]!
      expect(frontmatter).toContain('name: valid-skill')
      expect(frontmatter).toContain('version: 0.1.0')
      expect(frontmatter).toContain('compatibility:')
      expect(frontmatter).toContain('triggers:')
    })

    it('includes markdown body with headings after frontmatter', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'body-skill', '--type', 'skill'])

      const writeFileCalls = vi.mocked(writeFileSync).mock.calls
      const skillMdCall = writeFileCalls.find((call) => String(call[0]).endsWith('SKILL.md'))
      const content = skillMdCall![1] as string
      expect(content).toContain('# body-skill')
      expect(content).toContain('## When to use')
      expect(content).toContain('## Instructions')
      expect(content).toContain('## Examples')
    })
  })

  // -------------------------------------------------------------------------
  // JSON mode requires --name
  // -------------------------------------------------------------------------

  describe('JSON mode requires --name', () => {
    it('outputs VALIDATION_ERROR when --name is omitted in JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--type', 'skill'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.stringContaining('Name is required')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  // -------------------------------------------------------------------------
  // Unknown type
  // -------------------------------------------------------------------------

  describe('unknown package type', () => {
    it('outputs VALIDATION_ERROR for unknown type in JSON mode', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'init', '--json']

      await runInit(['init', '--name', 'bad-type', '--type', 'banana'])

      expect(outputModule.outputError).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.stringContaining('banana')
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })
})
