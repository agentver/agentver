import { extname } from 'node:path'
import type { FetchedFile, GitSource } from '../git/types.js'
import { readConfig } from '../registry/config.js'
import { checkFilePolicy, isBinaryContent } from './file-policy.js'
import { SCAN_RULES } from './patterns.js'
import type { ScanFinding, ScanOptions, ScanResult, ScanSeverity, ScanVerdict } from './types.js'

const SEVERITY_ORDER: Record<ScanSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
}

/**
 * Checks whether a given source URI matches any trusted source patterns
 * from the user's config. Trusted sources skip scanning entirely.
 */
function isTrustedSource(sourceUri: string, trustedPatterns: string[]): boolean {
  for (const pattern of trustedPatterns) {
    // Convert glob-style pattern to a regex
    // e.g. 'github.com/anthropics/*' → /^github\.com\/anthropics\/[^/]+$/
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')
    const regex = new RegExp(`^${escaped}$`)

    if (regex.test(sourceUri)) {
      return true
    }
  }
  return false
}

/**
 * Runs pattern matching against each line of text files.
 * Returns findings with file, line number, and evidence.
 */
function scanPatterns(files: FetchedFile[]): ScanFinding[] {
  const findings: ScanFinding[] = []

  for (const file of files) {
    if (isBinaryContent(file.content)) {
      continue
    }

    const lines = file.content.split('\n')

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!

      for (const rule of SCAN_RULES) {
        const fileExtension = extname(file.path).toLowerCase()
        if (rule.fileExtensions && !rule.fileExtensions.includes(fileExtension)) {
          continue
        }

        if (rule.pattern.test(line)) {
          const evidence = `[${rule.category}] line ${lineIdx + 1}`

          findings.push({
            severity: rule.severity,
            category: rule.category,
            file: file.path,
            line: lineIdx + 1,
            message: rule.message,
            evidence,
          })
        }
      }
    }
  }

  return findings
}

/**
 * Determines the overall verdict from the highest-severity finding.
 * CRITICAL or HIGH -> BLOCK, MEDIUM -> WARN, otherwise PASS.
 */
function determineVerdict(
  findings: ScanFinding[],
  blockSeverity: ScanSeverity = 'HIGH'
): ScanVerdict {
  if (findings.length === 0) {
    return 'PASS'
  }

  const blockThreshold = SEVERITY_ORDER[blockSeverity]

  let highestSeverity = 0
  for (const finding of findings) {
    const level = SEVERITY_ORDER[finding.severity]
    if (level > highestSeverity) {
      highestSeverity = level
    }
  }

  if (highestSeverity >= blockThreshold) {
    return 'BLOCK'
  }

  if (highestSeverity >= SEVERITY_ORDER.MEDIUM) {
    return 'WARN'
  }

  return 'PASS'
}

/**
 * Main security scanner orchestrator.
 *
 * Runs file policy checks on all files, then pattern matching on
 * text files. Aggregates findings and determines a verdict.
 *
 * Checks trusted sources — if the source matches a trusted pattern,
 * scanning is skipped and an immediate PASS is returned.
 */
export async function scanFiles(
  files: FetchedFile[],
  source: GitSource,
  options: ScanOptions
): Promise<ScanResult> {
  const startTime = performance.now()

  if (options.skipAudit) {
    return {
      verdict: 'PASS',
      findings: [],
      scannedAt: new Date().toISOString(),
      duration: 0,
      provider: 'built-in',
    }
  }

  const config = readConfig()
  const auditConfig = config.audit

  // Check if audit is disabled globally
  if (auditConfig?.enabled === false) {
    return {
      verdict: 'PASS',
      findings: [],
      scannedAt: new Date().toISOString(),
      duration: 0,
      provider: 'built-in',
    }
  }

  // Check trusted sources
  const sourceUri = `${source.host}/${source.owner}/${source.repo}`
  if (auditConfig?.trustedSources && isTrustedSource(sourceUri, auditConfig.trustedSources)) {
    return {
      verdict: 'PASS',
      findings: [],
      scannedAt: new Date().toISOString(),
      duration: 0,
      provider: 'built-in',
    }
  }

  const filteredFiles = files.filter((file) => file.path !== '.agentverignore')

  // Run file policy checks
  const policyFindings = checkFilePolicy(filteredFiles)

  // Run pattern matching on text files
  const patternFindings = scanPatterns(filteredFiles)

  // Aggregate all findings
  const allFindings = [...policyFindings, ...patternFindings]

  // Sort by severity (highest first), then by file
  allFindings.sort((a, b) => {
    const severityDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
    if (severityDiff !== 0) return severityDiff
    return a.file.localeCompare(b.file)
  })

  const blockSeverity = auditConfig?.blockSeverity ?? 'HIGH'
  const verdict = determineVerdict(allFindings, blockSeverity)
  const duration = Math.round(performance.now() - startTime)

  return {
    verdict,
    findings: allFindings,
    scannedAt: new Date().toISOString(),
    duration,
    provider: 'built-in',
  }
}
