import { auditResultSchema, createCLIOutputSchema } from '@agentver/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAuditScanResult,
  createFetchedFiles,
  createManifest,
  createManifestPackage,
  createScanFinding,
} from '../helpers/fixtures'
import { createNoopSpinner } from '../helpers/mock-spinner.js'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../git/fetcher.js', () => ({
  readFilesFromDirectory: vi.fn(),
}))

vi.mock('../../security/index.js', () => ({
  scanFiles: vi.fn(),
  renderScanResult: vi.fn(),
  SCAN_RULES: [],
}))

vi.mock('../../storage/manifest.js', () => ({
  readManifest: vi.fn(),
}))

vi.mock('../../storage/canonical.js', () => ({
  getCanonicalSkillPath: vi.fn(),
}))

vi.mock('../../output', () => ({
  isJSONMode: vi.fn().mockReturnValue(false),
  outputSuccess: vi.fn(),
  outputError: vi.fn(),
  createSpinner: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

import { Command } from 'commander'
import { registerAuditCommand } from '../../commands/audit'
import * as fetcherModule from '../../git/fetcher.js'
import * as outputModule from '../../output'
import * as securityModule from '../../security/index.js'
import * as canonicalModule from '../../storage/canonical.js'
import * as manifestModule from '../../storage/manifest.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerAuditCommand(program)
  return program
}

async function runAudit(args: string[]): Promise<void> {
  const program = createProgram()
  await program.parseAsync(['node', 'agentver', ...args])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commands/audit', () => {
  const originalCwd = process.cwd
  const originalArgv = process.argv
  const originalExit = process.exit

  beforeEach(() => {
    vi.clearAllMocks()
    process.cwd = vi.fn().mockReturnValue('/project')
    process.argv = ['node', 'agentver', 'audit']
    process.exit = vi.fn() as never

    vi.mocked(outputModule.createSpinner).mockReturnValue(createNoopSpinner() as unknown as ReturnType<typeof outputModule.createSpinner>)
    vi.mocked(outputModule.isJSONMode).mockReturnValue(false)
    vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
    vi.mocked(fetcherModule.readFilesFromDirectory).mockResolvedValue(createFetchedFiles(2))
    vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
    vi.mocked(canonicalModule.getCanonicalSkillPath).mockReturnValue(
      '/project/.agents/skills/test-skill'
    )
  })

  afterEach(() => {
    process.cwd = originalCwd
    process.argv = originalArgv
    process.exit = originalExit
  })

  // -------------------------------------------------------------------------
  // 1. Scan all installed
  // -------------------------------------------------------------------------

  describe('scan all installed', () => {
    it('reads manifest and scans each installed package', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'skill-a': createManifestPackage(),
            'skill-b': createManifestPackage(),
          },
        })
      )

      await runAudit(['audit'])

      expect(fetcherModule.readFilesFromDirectory).toHaveBeenCalledTimes(2)
      expect(securityModule.scanFiles).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // 2. Specific package
  // -------------------------------------------------------------------------

  describe('specific package', () => {
    it('only scans the named package', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: {
            'skill-a': createManifestPackage(),
            'skill-b': createManifestPackage(),
          },
        })
      )

      await runAudit(['audit', 'skill-a'])

      expect(fetcherModule.readFilesFromDirectory).toHaveBeenCalledTimes(1)
      expect(canonicalModule.getCanonicalSkillPath).toHaveBeenCalledWith(
        '/project',
        'skill-a',
        'project'
      )
    })
  })

  // -------------------------------------------------------------------------
  // 3. --path flag
  // -------------------------------------------------------------------------

  describe('--path flag', () => {
    it('scans an arbitrary directory instead of installed skills', async () => {
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'audit', '--json']

      await runAudit(['audit', '--path', 'custom/dir'])

      expect(fetcherModule.readFilesFromDirectory).toHaveBeenCalledWith('/project/custom/dir')
      expect(manifestModule.readManifest).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 4. Clean scan
  // -------------------------------------------------------------------------

  describe('clean scan', () => {
    it('shows PASS verdict when no findings', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: { 'clean-skill': createManifestPackage() },
        })
      )
      vi.mocked(securityModule.scanFiles).mockResolvedValue(createAuditScanResult('PASS'))
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'audit', '--json']

      await runAudit(['audit'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as Record<string, unknown>
      expect(typed.passed).toBe(true)
      expect(typed.findings).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // 5. Critical findings
  // -------------------------------------------------------------------------

  describe('critical findings', () => {
    it('reports findings with severity, file, and line', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: { 'risky-skill': createManifestPackage() },
        })
      )
      vi.mocked(securityModule.scanFiles).mockResolvedValue(
        createAuditScanResult('BLOCK', {
          findings: [
            createScanFinding({
              severity: 'CRITICAL',
              category: 'DANGEROUS_COMMAND',
              file: 'SKILL.md',
              line: 42,
              evidence: 'rm -rf /',
            }),
          ],
        })
      )
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'audit', '--json']

      await runAudit(['audit'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as { passed: boolean; findings: Array<Record<string, unknown>> }
      expect(typed.passed).toBe(false)
      expect(typed.findings).toHaveLength(1)
      expect(typed.findings[0]!.severity).toBe('CRITICAL')
      expect(typed.findings[0]!.file).toBe('SKILL.md')
      expect(typed.findings[0]!.line).toBe(42)
    })
  })

  // -------------------------------------------------------------------------
  // 6. Multiple severity levels
  // -------------------------------------------------------------------------

  describe('multiple severity levels', () => {
    it('reports CRITICAL, HIGH, and MEDIUM findings together', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: { 'multi-finding': createManifestPackage() },
        })
      )
      vi.mocked(securityModule.scanFiles).mockResolvedValue(
        createAuditScanResult('BLOCK', {
          findings: [
            createScanFinding({ severity: 'CRITICAL', category: 'DANGEROUS_COMMAND' }),
            createScanFinding({ severity: 'HIGH', category: 'DATA_EXFILTRATION' }),
            createScanFinding({ severity: 'MEDIUM', category: 'SUSPICIOUS_URL' }),
          ],
        })
      )
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'audit', '--json']

      await runAudit(['audit'])

      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as { findings: Array<{ severity: string }> }
      const severities = typed.findings.map((f) => f.severity)
      expect(severities).toContain('CRITICAL')
      expect(severities).toContain('HIGH')
      expect(severities).toContain('MEDIUM')
    })
  })

  // -------------------------------------------------------------------------
  // 7. --json output validates against auditResultSchema
  // -------------------------------------------------------------------------

  describe('--json output', () => {
    it('validates against auditResultSchema', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(
        createManifest({
          packages: { 'json-skill': createManifestPackage() },
        })
      )
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'audit', '--json']

      await runAudit(['audit'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const envelope = { success: true, data }
      const outputSchema = createCLIOutputSchema(auditResultSchema)
      const result = outputSchema.safeParse(envelope)
      expect(result.success).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // 8. Not installed
  // -------------------------------------------------------------------------

  describe('not installed', () => {
    it('shows helpful message when package is not installed', async () => {
      vi.mocked(manifestModule.readManifest).mockReturnValue(createManifest())
      vi.mocked(outputModule.isJSONMode).mockReturnValue(true)
      process.argv = ['node', 'agentver', 'audit', '--json']

      await runAudit(['audit', 'nonexistent-skill'])

      expect(outputModule.outputSuccess).toHaveBeenCalled()
      const [data] = vi.mocked(outputModule.outputSuccess).mock.calls[0]!
      const typed = data as { passed: boolean; findings: unknown[] }
      // Not found in manifest but returns a clean result with passed = true
      expect(typed.passed).toBe(true)
      expect(typed.findings).toEqual([])
    })
  })
})
