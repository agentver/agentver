import chalk from 'chalk'
import type ora from 'ora'
import type { ScanFinding, ScanResult, ScanSeverity } from './types.js'

const SEVERITY_COLOURS: Record<ScanSeverity, (text: string) => string> = {
  CRITICAL: chalk.red.bold,
  HIGH: chalk.red,
  MEDIUM: chalk.yellow,
  LOW: chalk.dim,
  INFO: chalk.dim,
}

const SEVERITY_LABELS: Record<ScanSeverity, string> = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  INFO: 'INFO',
}

/**
 * Groups findings by severity, then by file path.
 */
function groupFindings(findings: ScanFinding[]): Map<ScanSeverity, Map<string, ScanFinding[]>> {
  const grouped = new Map<ScanSeverity, Map<string, ScanFinding[]>>()

  for (const finding of findings) {
    let severityMap = grouped.get(finding.severity)
    if (!severityMap) {
      severityMap = new Map<string, ScanFinding[]>()
      grouped.set(finding.severity, severityMap)
    }

    let fileFindings = severityMap.get(finding.file)
    if (!fileFindings) {
      fileFindings = []
      severityMap.set(finding.file, fileFindings)
    }

    fileFindings.push(finding)
  }

  return grouped
}

/**
 * Renders scan results to the terminal via the provided spinner.
 *
 * - BLOCK findings are shown in red with file, line, and evidence
 * - WARN findings are shown in yellow
 * - PASS shows a green tick with a single line
 */
export function renderScanResult(result: ScanResult, spinner: ReturnType<typeof ora>): void {
  if (result.verdict === 'PASS' && result.findings.length === 0) {
    spinner.succeed(chalk.green('Security scan passed') + chalk.dim(` (${result.duration}ms)`))
    return
  }

  // Stop the spinner before printing detailed output
  spinner.stop()

  const grouped = groupFindings(result.findings)
  const severityOrder: ScanSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']

  console.log()
  console.log(
    chalk.bold('Security scan results') +
      chalk.dim(
        ` (${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}, ${result.duration}ms)`
      )
  )
  console.log()

  for (const severity of severityOrder) {
    const fileMap = grouped.get(severity)
    if (!fileMap) continue

    const colour = SEVERITY_COLOURS[severity]
    const label = SEVERITY_LABELS[severity]

    console.log(colour(`  ${label}`))

    for (const [filePath, findings] of fileMap) {
      console.log(chalk.dim(`    ${filePath}`))

      for (const finding of findings) {
        const lineRef = finding.line ? chalk.dim(`:${finding.line}`) : ''
        console.log(`      ${colour('\u2716')} ${finding.message}${lineRef}`)

        if (finding.evidence) {
          const truncated =
            finding.evidence.length > 120
              ? `${finding.evidence.slice(0, 120)}...`
              : finding.evidence
          console.log(chalk.dim(`        ${truncated}`))
        }
      }
    }

    console.log()
  }

  if (result.verdict === 'BLOCK') {
    console.log(
      chalk.red.bold('  Scan verdict: BLOCK') +
        chalk.red(' — install aborted due to security findings')
    )
    console.log(chalk.dim('  Use --skip-audit to bypass the security scan'))
  } else if (result.verdict === 'WARN') {
    console.log(
      chalk.yellow.bold('  Scan verdict: WARN') +
        chalk.yellow(' — potential security concerns detected')
    )
  }

  console.log()
}
