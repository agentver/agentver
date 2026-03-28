import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type ora from 'ora'
import { renderScanResult } from '../../security/reporter.js'
import type { ScanFinding, ScanResult } from '../../security/types.js'

type MockSpinner = {
  [K in keyof ReturnType<typeof ora>]: ReturnType<typeof ora>[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<(...args: A) => R>>
    : ReturnType<typeof ora>[K]
}

function createMockSpinner(): MockSpinner {
  return {
    succeed: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    text: '',
    color: 'cyan',
    indent: 0,
    isSpinning: false,
    interval: 80,
    spinner: { interval: 80, frames: ['-'] },
    prefixText: '',
    suffixText: '',
    render: vi.fn(),
    clear: vi.fn(),
    frame: vi.fn(),
    stopAndPersist: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  } as unknown as MockSpinner
}

function makeFinding(overrides: Partial<ScanFinding> = {}): ScanFinding {
  return {
    severity: 'MEDIUM',
    category: 'DANGEROUS_COMMAND',
    file: 'install.sh',
    message: 'Dangerous command detected',
    ...overrides,
  }
}

function makeResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    verdict: 'PASS',
    findings: [],
    duration: 42,
    scannedAt: '2026-03-28T00:00:00Z',
    provider: 'built-in',
    ...overrides,
  }
}

function allOutput(): string {
  const spy = console.log as unknown as ReturnType<typeof vi.fn>
  return spy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n')
}

describe('renderScanResult', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders PASS verdict with green success message on spinner', () => {
    const spinner = createMockSpinner()
    const result = makeResult({ verdict: 'PASS', findings: [], duration: 42 })

    renderScanResult(result, spinner as unknown as ReturnType<typeof ora>)

    expect(spinner.succeed).toHaveBeenCalledOnce()
    const succeedArg = spinner.succeed.mock.calls[0]![0] as string
    expect(succeedArg).toContain('Security scan passed')
    expect(succeedArg).toContain('42ms')
    expect(spinner.stop).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
  })

  it('renders BLOCK verdict with critical finding details', () => {
    const spinner = createMockSpinner()
    const result = makeResult({
      verdict: 'BLOCK',
      findings: [
        makeFinding({
          severity: 'CRITICAL',
          file: 'install.sh',
          line: 5,
          message: 'Dangerous rm -rf command',
          evidence: 'rm -rf /',
        }),
      ],
    })

    renderScanResult(result, spinner as unknown as ReturnType<typeof ora>)

    expect(spinner.stop).toHaveBeenCalledOnce()
    const output = allOutput()
    expect(output).toContain('CRITICAL')
    expect(output).toContain('install.sh')
    expect(output).toContain('Dangerous rm -rf command')
    expect(output).toContain(':5')
    expect(output).toContain('rm -rf /')
    expect(output).toContain('BLOCK')
    expect(output).toContain('install aborted')
    expect(output).toContain('--skip-audit')
  })

  it('renders WARN verdict with multiple warnings', () => {
    const spinner = createMockSpinner()
    const result = makeResult({
      verdict: 'WARN',
      findings: [
        makeFinding({ severity: 'MEDIUM', file: 'a.ts', message: 'First warning' }),
        makeFinding({ severity: 'MEDIUM', file: 'b.ts', message: 'Second warning' }),
        makeFinding({ severity: 'MEDIUM', file: 'c.ts', message: 'Third warning' }),
      ],
    })

    renderScanResult(result, spinner as unknown as ReturnType<typeof ora>)

    expect(spinner.stop).toHaveBeenCalledOnce()
    const output = allOutput()
    expect(output).toContain('WARN')
    expect(output).toContain('potential security concerns')
    expect(output).toContain('First warning')
    expect(output).toContain('Second warning')
    expect(output).toContain('Third warning')
  })

  it('orders findings by severity: CRITICAL > HIGH > MEDIUM > LOW > INFO', () => {
    const spinner = createMockSpinner()
    const result = makeResult({
      verdict: 'BLOCK',
      findings: [
        makeFinding({ severity: 'LOW', file: 'low.ts', message: 'Low issue' }),
        makeFinding({ severity: 'CRITICAL', file: 'crit.ts', message: 'Critical issue' }),
        makeFinding({ severity: 'MEDIUM', file: 'med.ts', message: 'Medium issue' }),
        makeFinding({ severity: 'HIGH', file: 'high.ts', message: 'High issue' }),
      ],
    })

    renderScanResult(result, spinner as unknown as ReturnType<typeof ora>)

    const output = allOutput()
    const critIdx = output.indexOf('Critical issue')
    const highIdx = output.indexOf('High issue')
    const medIdx = output.indexOf('Medium issue')
    const lowIdx = output.indexOf('Low issue')

    expect(critIdx).toBeLessThan(highIdx)
    expect(highIdx).toBeLessThan(medIdx)
    expect(medIdx).toBeLessThan(lowIdx)
  })

  it('groups findings by file within the same severity', () => {
    const spinner = createMockSpinner()
    const result = makeResult({
      verdict: 'BLOCK',
      findings: [
        makeFinding({ severity: 'CRITICAL', file: 'a.ts', message: 'First in a.ts' }),
        makeFinding({ severity: 'CRITICAL', file: 'b.ts', message: 'In b.ts' }),
        makeFinding({ severity: 'CRITICAL', file: 'a.ts', message: 'Second in a.ts' }),
      ],
    })

    renderScanResult(result, spinner as unknown as ReturnType<typeof ora>)

    const output = allOutput()
    expect(output).toContain('a.ts')
    expect(output).toContain('b.ts')
    expect(output).toContain('First in a.ts')
    expect(output).toContain('Second in a.ts')
    expect(output).toContain('In b.ts')

    // Both a.ts findings should appear before b.ts findings (insertion order grouping)
    const firstA = output.indexOf('First in a.ts')
    const secondA = output.indexOf('Second in a.ts')
    const inB = output.indexOf('In b.ts')
    expect(firstA).toBeLessThan(secondA)
    expect(secondA).toBeLessThan(inB)
  })

  it('renders WARN with zero findings showing "0 findings" in header', () => {
    const spinner = createMockSpinner()
    const result = makeResult({ verdict: 'WARN', findings: [] })

    renderScanResult(result, spinner as unknown as ReturnType<typeof ora>)

    expect(spinner.stop).toHaveBeenCalledOnce()
    const output = allOutput()
    expect(output).toContain('0 findings')
    expect(output).toContain('WARN')
  })

  it('uses singular "finding" for exactly one finding', () => {
    const spinner = createMockSpinner()
    const result = makeResult({
      verdict: 'WARN',
      findings: [makeFinding({ severity: 'LOW', message: 'Minor issue' })],
    })

    renderScanResult(result, spinner as unknown as ReturnType<typeof ora>)

    const output = allOutput()
    expect(output).toContain('1 finding,')
    expect(output).not.toContain('1 findings')
  })

  it('truncates evidence longer than 120 characters', () => {
    const longEvidence = 'x'.repeat(150)
    const exactEvidence = 'y'.repeat(120)
    const spinner = createMockSpinner()
    const result = makeResult({
      verdict: 'BLOCK',
      findings: [
        makeFinding({ severity: 'CRITICAL', file: 'long.ts', evidence: longEvidence }),
        makeFinding({ severity: 'CRITICAL', file: 'exact.ts', evidence: exactEvidence }),
      ],
    })

    renderScanResult(result, spinner as unknown as ReturnType<typeof ora>)

    const output = allOutput()
    // Long evidence should be truncated with ellipsis
    expect(output).toContain('x'.repeat(120) + '...')
    expect(output).not.toContain('x'.repeat(121))
    // Exact 120-char evidence should appear without ellipsis
    expect(output).toContain('y'.repeat(120))
    expect(output).not.toContain('y'.repeat(120) + '...')
  })

  it('omits line reference when line is undefined', () => {
    const spinner = createMockSpinner()
    const result = makeResult({
      verdict: 'WARN',
      findings: [makeFinding({ severity: 'MEDIUM', line: undefined, message: 'No line ref' })],
    })

    renderScanResult(result, spinner as unknown as ReturnType<typeof ora>)

    const output = allOutput()
    expect(output).toContain('No line ref')
    expect(output).not.toContain(':undefined')
    // The message line should not contain a colon after the message
    const messageLine = output.split('\n').find((l) => l.includes('No line ref'))
    expect(messageLine).toBeDefined()
    expect(messageLine).not.toMatch(/No line ref\s*:/)
  })

  it('omits evidence line when evidence is undefined', () => {
    const spinner = createMockSpinner()
    const result = makeResult({
      verdict: 'WARN',
      findings: [
        makeFinding({ severity: 'MEDIUM', evidence: undefined, message: 'No evidence here' }),
      ],
    })

    renderScanResult(result, spinner as unknown as ReturnType<typeof ora>)

    const spy = console.log as unknown as ReturnType<typeof vi.fn>
    const calls = spy.mock.calls.map((c: unknown[]) => c.join(' '))
    // Find the message line and ensure no evidence line follows it
    const messageIdx = calls.findIndex((line: string) => line.includes('No evidence here'))
    expect(messageIdx).toBeGreaterThan(-1)
    // The next line should not be an indented evidence line (8 spaces)
    if (messageIdx < calls.length - 1) {
      const nextLine = calls[messageIdx + 1] as string
      expect(nextLine).not.toMatch(/^\s{8}/)
    }
  })
})
