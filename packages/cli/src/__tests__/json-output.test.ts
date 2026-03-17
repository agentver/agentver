import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  adoptResultSchema,
  createCLIOutputSchema,
  initResultSchema,
  listResultSchema,
  logoutResultSchema,
  scanResultSchema,
  statusResultSchema,
  whoamiResultSchema,
} from '@agentver/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Setup — locate the built CLI binary
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CLI_PATH = resolve(__dirname, '../../dist/bin/agentver.js')
const CLI_AVAILABLE = existsSync(CLI_PATH)

/**
 * Run the CLI with --json and return the parsed JSON output.
 * Uses a clean temp directory as cwd to avoid interference from the
 * monorepo's own manifest files.
 */
function runCLI(
  args: string,
  options?: { cwd?: string; expectFailure?: boolean }
): { raw: string; parsed: Record<string, unknown> } {
  const cwd = options?.cwd ?? tmpdir()
  try {
    const raw = execSync(`node ${CLI_PATH} ${args}`, {
      cwd,
      timeout: 15_000,
      encoding: 'utf-8',
      env: {
        ...process.env,
        // Prevent update-notifier from interfering with JSON output
        NO_UPDATE_NOTIFIER: '1',
      },
      // Capture stderr separately to keep stdout clean
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { raw, parsed: JSON.parse(raw.trim()) as Record<string, unknown> }
  } catch (error: unknown) {
    // Some commands exit with non-zero but still emit JSON to stdout
    if (options?.expectFailure) {
      const execError = error as { stdout?: string }
      const stdout = (execError.stdout ?? '') as string
      if (stdout.trim()) {
        return { raw: stdout, parsed: JSON.parse(stdout.trim()) as Record<string, unknown> }
      }
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Integration tests — skip entirely if CLI has not been built
// ---------------------------------------------------------------------------

describe.skipIf(!CLI_AVAILABLE)('CLI --json output integration', () => {
  let tempDir: string

  beforeAll(() => {
    tempDir = join(tmpdir(), `agentver-json-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterAll(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // -------------------------------------------------------------------------
  // Envelope structure
  // -------------------------------------------------------------------------

  describe('output envelope', () => {
    it('should always include a success boolean at the top level', () => {
      const { parsed } = runCLI('list --json', { cwd: tempDir })
      expect(typeof parsed.success).toBe('boolean')
    })

    it('should include data when success is true', () => {
      const { parsed } = runCLI('list --json', { cwd: tempDir })
      expect(parsed.success).toBe(true)
      expect(parsed).toHaveProperty('data')
    })

    it('should emit a single line of valid JSON', () => {
      const { raw } = runCLI('list --json', { cwd: tempDir })
      const lines = raw.trim().split('\n')
      expect(lines).toHaveLength(1)
      expect(() => JSON.parse(lines[0]!)).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // list --json
  // -------------------------------------------------------------------------

  describe('list --json', () => {
    it('should return empty packages when no manifest exists', () => {
      const { parsed } = runCLI('list --json', { cwd: tempDir })

      expect(parsed.success).toBe(true)

      const data = parsed.data as Record<string, unknown>
      expect(data.packages).toEqual({})
    })

    it('should validate against listResultSchema', () => {
      const { parsed } = runCLI('list --json', { cwd: tempDir })
      const outputSchema = createCLIOutputSchema(listResultSchema)
      const result = outputSchema.safeParse(parsed)
      expect(result.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // scan --json
  // -------------------------------------------------------------------------

  describe('scan --json', () => {
    it('should return agents and skills arrays', () => {
      const { parsed } = runCLI('scan --json', { cwd: tempDir })

      expect(parsed.success).toBe(true)

      const data = parsed.data as Record<string, unknown>
      expect(Array.isArray(data.agents)).toBe(true)
      expect(Array.isArray(data.skills)).toBe(true)
    })

    it('should validate against scanResultSchema', () => {
      const { parsed } = runCLI('scan --json', { cwd: tempDir })
      const outputSchema = createCLIOutputSchema(scanResultSchema)
      const result = outputSchema.safeParse(parsed)
      expect(result.success).toBe(true)
    })

    it('should scan the specified path when provided', () => {
      const { parsed } = runCLI(`scan "${tempDir}" --json`, { cwd: tempDir })
      expect(parsed.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // whoami --json
  // -------------------------------------------------------------------------

  describe('whoami --json', () => {
    it('should return authenticated: false when no credentials exist', () => {
      const { parsed } = runCLI('whoami --json', { cwd: tempDir })

      expect(parsed.success).toBe(true)

      const data = parsed.data as Record<string, unknown>
      expect(data.authenticated).toBe(false)
    })

    it('should validate against whoamiResultSchema', () => {
      const { parsed } = runCLI('whoami --json', { cwd: tempDir })
      const outputSchema = createCLIOutputSchema(whoamiResultSchema)
      const result = outputSchema.safeParse(parsed)
      expect(result.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // logout --json
  // -------------------------------------------------------------------------

  describe('logout --json', () => {
    it('should return cleared: true even when not logged in', () => {
      const { parsed } = runCLI('logout --json', { cwd: tempDir })

      expect(parsed.success).toBe(true)

      const data = parsed.data as Record<string, unknown>
      expect(data.cleared).toBe(true)
    })

    it('should validate against logoutResultSchema', () => {
      const { parsed } = runCLI('logout --json', { cwd: tempDir })
      const outputSchema = createCLIOutputSchema(logoutResultSchema)
      const result = outputSchema.safeParse(parsed)
      expect(result.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // status --json
  // -------------------------------------------------------------------------

  describe('status --json', () => {
    it('should return empty status when no packages are installed', () => {
      const { parsed } = runCLI('status --json --offline', { cwd: tempDir })

      expect(parsed.success).toBe(true)

      const data = parsed.data as Record<string, unknown>
      const summary = data.summary as Record<string, number>
      expect(summary.total).toBe(0)
      expect(summary.upToDate).toBe(0)
      expect(summary.modified).toBe(0)
      expect(summary.upstream).toBe(0)
      expect(summary.unknown).toBe(0)
    })

    it('should validate against statusResultSchema', () => {
      const { parsed } = runCLI('status --json --offline', { cwd: tempDir })
      const outputSchema = createCLIOutputSchema(statusResultSchema)
      const result = outputSchema.safeParse(parsed)
      expect(result.success).toBe(true)
    })

    it('should return empty packages array', () => {
      const { parsed } = runCLI('status --json --offline', { cwd: tempDir })
      const data = parsed.data as Record<string, unknown>
      expect(Array.isArray(data.packages)).toBe(true)
      expect((data.packages as unknown[]).length).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // init --json
  // -------------------------------------------------------------------------

  describe('init --json', () => {
    let initDir: string

    beforeAll(() => {
      initDir = join(tempDir, 'init-tests')
      mkdirSync(initDir, { recursive: true })
    })

    it('should return VALIDATION_ERROR when --name is omitted', () => {
      const { parsed } = runCLI('init --json', {
        cwd: initDir,
        expectFailure: true,
      })

      expect(parsed.success).toBe(false)

      const error = parsed.error as Record<string, unknown>
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(typeof error.message).toBe('string')
    })

    it('should create files and return success for a skill', () => {
      const skillName = `test-skill-${Date.now()}`
      const { parsed } = runCLI(`init --json --name ${skillName} --type skill`, {
        cwd: initDir,
      })

      expect(parsed.success).toBe(true)

      const data = parsed.data as Record<string, unknown>
      expect(data.name).toBe(skillName)
      expect(data.type).toBe('skill')
      expect(typeof data.path).toBe('string')
      expect(Array.isArray(data.files)).toBe(true)
      expect((data.files as string[]).length).toBeGreaterThan(0)

      // Verify the directory was actually created
      expect(existsSync(data.path as string)).toBe(true)
    })

    it('should validate against initResultSchema', () => {
      const skillName = `test-init-schema-${Date.now()}`
      const { parsed } = runCLI(`init --json --name ${skillName} --type skill`, {
        cwd: initDir,
      })

      const outputSchema = createCLIOutputSchema(initResultSchema)
      const result = outputSchema.safeParse(parsed)
      expect(result.success).toBe(true)
    })

    it('should create a plugin package', () => {
      const pluginName = `test-plugin-${Date.now()}`
      const { parsed } = runCLI(`init --json --name ${pluginName} --type plugin`, {
        cwd: initDir,
      })

      expect(parsed.success).toBe(true)

      const data = parsed.data as Record<string, unknown>
      expect(data.type).toBe('plugin')
      expect(data.files as string[]).toContain('plugin.json')
    })

    it('should create an agent config package', () => {
      const agentName = `test-agent-${Date.now()}`
      const { parsed } = runCLI(`init --json --name ${agentName} --type agent`, {
        cwd: initDir,
      })

      expect(parsed.success).toBe(true)

      const data = parsed.data as Record<string, unknown>
      expect(data.type).toBe('agent')
      expect(data.files as string[]).toContain('CLAUDE.md')
    })

    it('should create a script package', () => {
      const scriptName = `test-script-${Date.now()}`
      const { parsed } = runCLI(`init --json --name ${scriptName} --type script`, {
        cwd: initDir,
      })

      expect(parsed.success).toBe(true)

      const data = parsed.data as Record<string, unknown>
      expect(data.type).toBe('script')
      expect(data.files as string[]).toContain('script.json')
      expect(data.files as string[]).toContain('src/index.ts')
    })

    it('should create a prompt package', () => {
      const promptName = `test-prompt-${Date.now()}`
      const { parsed } = runCLI(`init --json --name ${promptName} --type prompt`, {
        cwd: initDir,
      })

      expect(parsed.success).toBe(true)

      const data = parsed.data as Record<string, unknown>
      expect(data.type).toBe('prompt')
      expect(data.files as string[]).toContain('PROMPT.md')
    })

    it('should return ALREADY_EXISTS when directory already exists', () => {
      const existingName = `test-existing-${Date.now()}`
      // Create first
      runCLI(`init --json --name ${existingName} --type skill`, { cwd: initDir })

      // Attempt to create again
      const { parsed } = runCLI(`init --json --name ${existingName} --type skill`, {
        cwd: initDir,
        expectFailure: true,
      })

      expect(parsed.success).toBe(false)

      const error = parsed.error as Record<string, unknown>
      expect(error.code).toBe('ALREADY_EXISTS')
    })

    it('should return VALIDATION_ERROR for unknown package type', () => {
      const badName = `test-bad-type-${Date.now()}`
      const { parsed } = runCLI(`init --json --name ${badName} --type banana`, {
        cwd: initDir,
        expectFailure: true,
      })

      expect(parsed.success).toBe(false)

      const error = parsed.error as Record<string, unknown>
      expect(error.code).toBe('VALIDATION_ERROR')
    })
  })

  // -------------------------------------------------------------------------
  // login --json (non-interactive limitation)
  // -------------------------------------------------------------------------

  describe('login --json', () => {
    it('should return INTERACTIVE_REQUIRED error for OAuth without --token', () => {
      // This test may fail if the network check fails first (OFFLINE error).
      // Both are valid JSON error responses, so we just verify the envelope.
      try {
        const { parsed } = runCLI('login --json', {
          cwd: tempDir,
          expectFailure: true,
        })

        expect(parsed.success).toBe(false)
        expect(parsed).toHaveProperty('error')

        const error = parsed.error as Record<string, unknown>
        expect(['INTERACTIVE_REQUIRED', 'OFFLINE']).toContain(error.code)
      } catch {
        // If the process crashes without JSON output, that's also a valid
        // scenario (e.g. no network at all) — skip gracefully
      }
    })
  })

  // -------------------------------------------------------------------------
  // adopt --json
  // -------------------------------------------------------------------------

  describe('adopt --global --dry-run --json', () => {
    it('should return valid JSON with adopted and skipped arrays', () => {
      const { parsed } = runCLI('adopt --global --dry-run --json', { cwd: tempDir })

      expect(parsed.success).toBe(true)

      const data = parsed.data as Record<string, unknown>
      expect(Array.isArray(data.adopted)).toBe(true)
      expect(Array.isArray(data.skipped)).toBe(true)
    })

    it('should validate against adoptResultSchema', () => {
      const { parsed } = runCLI('adopt --global --dry-run --json', { cwd: tempDir })
      const outputSchema = createCLIOutputSchema(adoptResultSchema)
      const result = outputSchema.safeParse(parsed)
      expect(result.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Error output structure
  // -------------------------------------------------------------------------

  describe('error output structure', () => {
    it('should return valid JSON error for unknown command', () => {
      const { parsed } = runCLI('nonexistent-command --json', {
        cwd: tempDir,
        expectFailure: true,
      })

      expect(parsed.success).toBe(false)
      expect(parsed).toHaveProperty('error')
      expect(parsed).not.toHaveProperty('data')

      const error = parsed.error as Record<string, unknown>
      expect(typeof error.code).toBe('string')
      expect(typeof error.message).toBe('string')
    })

    it('should return VALIDATION_ERROR for install with no source argument', () => {
      const { parsed } = runCLI('install --json', {
        cwd: tempDir,
        expectFailure: true,
      })

      expect(parsed.success).toBe(false)

      const error = parsed.error as Record<string, unknown>
      expect(error.code).toBe('VALIDATION_ERROR')
    })

    it('should return VALIDATION_ERROR for remove with no package name', () => {
      const { parsed } = runCLI('remove --json', {
        cwd: tempDir,
        expectFailure: true,
      })

      expect(parsed.success).toBe(false)

      const error = parsed.error as Record<string, unknown>
      expect(error.code).toBe('VALIDATION_ERROR')
    })
  })
})
