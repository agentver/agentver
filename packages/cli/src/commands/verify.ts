import type { ManifestV2Package } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import type ora from 'ora'
import { readFilesFromDirectory } from '../git/fetcher.js'
import type { GitSource } from '../git/types.js'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output'
import { registryFetch } from '../registry/client.js'
import { SCAN_RULES, scanFiles } from '../security/index.js'
import type { ScanResult } from '../security/types.js'
import { getCanonicalSkillPath } from '../storage/canonical.js'
import { computeSha256FromFiles } from '../storage/integrity.js'
import { readLockfile } from '../storage/lockfile.js'
import { readManifest } from '../storage/manifest.js'
import { parseUriSegments } from '../utils/uri.js'

type VerifyOptions = {
  json?: boolean
  strict?: boolean
}

type VerificationApiResponse = {
  isVerified: boolean
  publisherVerified: boolean
  publisherName: string
  publisherSlug: string
  authorVerified: boolean
  latestVersion: string | null
  sha256: string | null
}

type VerifyResult = {
  skillName: string
  publisherVerified: boolean
  publisherSlug: string
  integrityPassed: boolean
  securityPassed: boolean
  securityRuleCount: number
  securityIssueCount: number
  overallPassed: boolean
}

const FALLBACK_SOURCE: GitSource = {
  host: 'github.com',
  owner: 'local',
  repo: 'verify',
  path: '',
  ref: 'HEAD',
}

function buildSourceFromManifest(pkg: ManifestV2Package | undefined): GitSource {
  if (!pkg || pkg.source.type !== 'git') {
    return FALLBACK_SOURCE
  }

  const { source } = pkg
  const segments = parseUriSegments(source.uri)

  return {
    host: (segments?.host ?? 'github.com') as GitSource['host'],
    owner: segments?.owner ?? 'unknown',
    repo: segments?.repo ?? 'unknown',
    path: source.path,
    ref: source.ref,
    commit: source.commit,
  }
}

function parseSkillName(name: string): { org: string; skill: string } | null {
  // Supports @org/skill-name or org/skill-name
  const cleaned = name.startsWith('@') ? name.slice(1) : name
  const parts = cleaned.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null
  }
  return { org: parts[0], skill: parts[1] }
}

async function runSecurityScan(
  dirPath: string,
  source: GitSource,
  strict: boolean
): Promise<{ passed: boolean; ruleCount: number; issueCount: number; result: ScanResult | null }> {
  try {
    const files = await readFilesFromDirectory(dirPath)

    if (files.length === 0) {
      return { passed: true, ruleCount: 0, issueCount: 0, result: null }
    }

    const result = await scanFiles(files, source, { skipAudit: false })
    const issueCount = result.findings.length

    let passed: boolean
    if (strict) {
      passed = result.verdict === 'PASS'
    } else {
      passed = result.verdict === 'PASS' || result.verdict === 'WARN'
    }

    // Count rules (each unique pattern ID in the scanner)
    const ruleCount = SCAN_RULES.length

    return { passed, ruleCount, issueCount, result }
  } catch {
    return { passed: false, ruleCount: 0, issueCount: 0, result: null }
  }
}

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify [name]')
    .description('Verify a skill — checks publisher, integrity, and security')
    .option('--strict', 'Fail on WARN verdicts, not just BLOCK')
    .action(async (name: string | undefined, options: VerifyOptions) => {
      const jsonMode = isJSONMode()
      const projectRoot = process.cwd()
      const strict = options.strict ?? false

      // Determine skill name — from argument or manifest
      let skillName: string
      if (name) {
        skillName = name
      } else {
        const manifest = readManifest(projectRoot)
        const packageNames = Object.keys(manifest.packages)
        if (packageNames.length === 0) {
          if (jsonMode) {
            outputError('NO_SKILL', 'No skill name provided and no packages installed')
            return
          }
          process.stderr.write(chalk.red('No skill name provided and no packages installed.\n'))
          process.stderr.write(chalk.dim('Usage: agentver verify @org/skill-name\n'))
          process.exitCode = 1
          return
        }
        if (packageNames.length === 1) {
          skillName = packageNames[0]!
        } else {
          if (jsonMode) {
            outputError(
              'AMBIGUOUS_SKILL',
              `Multiple packages installed. Specify one: ${packageNames.join(', ')}`
            )
            return
          }
          process.stderr.write(
            chalk.red('Multiple packages installed. Please specify which to verify:\n')
          )
          for (const pkg of packageNames) {
            process.stderr.write(`  ${chalk.cyan(pkg)}\n`)
          }
          process.exitCode = 1
          return
        }
      }

      const parsed = parseSkillName(skillName)
      if (!parsed) {
        if (jsonMode) {
          outputError(
            'INVALID_NAME',
            `Invalid skill name "${skillName}". Expected format: @org/skill-name`
          )
          return
        }
        process.stderr.write(
          chalk.red(`Invalid skill name "${skillName}". Expected format: @org/skill-name\n`)
        )
        process.exitCode = 1
        return
      }

      if (!jsonMode) {
        process.stderr.write(`\n${chalk.bold(`Verifying @${parsed.org}/${parsed.skill}...`)}\n\n`)
      }

      // 1. Publisher verification — fetch from platform
      const publisherSpinner = createSpinner('Checking publisher verification...')
      publisherSpinner.start()

      let publisherVerified = false
      let publisherSlug = parsed.org

      try {
        const verifyData = await registryFetch<VerificationApiResponse>(
          `/skills/${parsed.org}/${parsed.skill}/verify`
        )
        publisherVerified = verifyData.publisherVerified
        publisherSlug = verifyData.publisherSlug

        if (!jsonMode) {
          if (publisherVerified) {
            ;(publisherSpinner as ReturnType<typeof ora>).succeed(
              `Publisher verified (@${publisherSlug})`
            )
          } else {
            ;(publisherSpinner as ReturnType<typeof ora>).fail(
              `Publisher not verified (@${publisherSlug})`
            )
          }
        } else {
          publisherSpinner.stop()
        }
      } catch (error) {
        if (!jsonMode) {
          const message = error instanceof Error ? error.message : String(error)
          ;(publisherSpinner as ReturnType<typeof ora>).warn(
            `Could not check publisher: ${message}`
          )
        } else {
          publisherSpinner.stop()
        }
      }

      // 2. Integrity check — compare local files against lockfile
      const integritySpinner = createSpinner('Checking integrity...')
      integritySpinner.start()

      let integrityPassed = false

      try {
        const manifest = readManifest(projectRoot)
        const lockfile = readLockfile(projectRoot)
        const pkg = manifest.packages[skillName]
        const lockPkg = lockfile.packages[skillName]

        if (pkg && lockPkg?.integrity) {
          const canonicalPath = getCanonicalSkillPath(projectRoot, skillName, 'project')
          const files = await readFilesFromDirectory(canonicalPath)

          if (files.length > 0) {
            const localHash = computeSha256FromFiles(files)
            integrityPassed = localHash === lockPkg.integrity
          }
        } else if (!pkg) {
          // Skill not installed locally — skip integrity (not a failure)
          integrityPassed = true
        }

        if (!jsonMode) {
          if (integrityPassed) {
            ;(integritySpinner as ReturnType<typeof ora>).succeed(
              'Integrity check passed (SHA256 match)'
            )
          } else {
            ;(integritySpinner as ReturnType<typeof ora>).fail(
              'Integrity check failed (SHA256 mismatch)'
            )
          }
        } else {
          integritySpinner.stop()
        }
      } catch {
        integrityPassed = false
        if (!jsonMode) {
          ;(integritySpinner as ReturnType<typeof ora>).warn(
            'Integrity check skipped (skill not installed locally)'
          )
          integrityPassed = true // Not a failure if not installed
        } else {
          integritySpinner.stop()
          integrityPassed = true
        }
      }

      // 3. Security audit
      const securitySpinner = createSpinner('Running security audit...')
      securitySpinner.start()

      let securityPassed = true
      let securityRuleCount = 0
      let securityIssueCount = 0

      try {
        const manifest = readManifest(projectRoot)
        const pkg = manifest.packages[skillName]

        if (pkg) {
          const canonicalPath = getCanonicalSkillPath(projectRoot, skillName, 'project')
          const source = buildSourceFromManifest(pkg)
          const scanResult = await runSecurityScan(canonicalPath, source, strict)

          securityPassed = scanResult.passed
          securityRuleCount = scanResult.ruleCount
          securityIssueCount = scanResult.issueCount
        }

        if (!jsonMode) {
          if (securityPassed) {
            ;(securitySpinner as ReturnType<typeof ora>).succeed(
              `Security audit passed (${securityRuleCount} rules, ${securityIssueCount} issues)`
            )
          } else {
            ;(securitySpinner as ReturnType<typeof ora>).fail(
              `Security audit failed (${securityRuleCount} rules, ${securityIssueCount} issues)`
            )
          }
        } else {
          securitySpinner.stop()
        }
      } catch {
        securityPassed = false
        if (!jsonMode) {
          ;(securitySpinner as ReturnType<typeof ora>).warn('Security audit could not run')
        } else {
          securitySpinner.stop()
        }
      }

      // Summary
      const overallPassed = publisherVerified && integrityPassed && securityPassed

      const result: VerifyResult = {
        skillName,
        publisherVerified,
        publisherSlug,
        integrityPassed,
        securityPassed,
        securityRuleCount,
        securityIssueCount,
        overallPassed,
      }

      if (jsonMode) {
        outputSuccess(result)
        if (!overallPassed) {
          process.exitCode = 1
        }
        return
      }

      process.stderr.write('\n')

      if (overallPassed) {
        process.stderr.write(chalk.green.bold('Skill is verified and safe to use.\n'))
      } else {
        process.stderr.write(chalk.red.bold('Skill verification failed.\n'))
        process.exitCode = 1
      }
    })
}
