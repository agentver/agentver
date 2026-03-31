import { join } from 'node:path'
import type { AuditResult, ManifestV2Package } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import type ora from 'ora'
import { readFilesFromDirectory } from '../git/fetcher.js'
import type { GitSource } from '../git/types.js'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output'
import type { ScanResult as SecurityScanResult } from '../security/index.js'
import { renderScanResult, scanFiles } from '../security/index.js'
import { getCanonicalSkillPath } from '../storage/canonical.js'
import { readManifest } from '../storage/manifest.js'
import { getDisplayName, resolvePackageQuery } from '../storage/package-identity.js'
import type { Scope } from '../utils/paths.js'

type AuditOptions = {
  path?: string
  global?: boolean
}

const FALLBACK_SOURCE: GitSource = {
  host: 'github.com',
  owner: 'local',
  repo: 'audit',
  path: '',
  ref: 'HEAD',
}

/**
 * Builds a placeholder GitSource for locally-installed packages.
 * The scanner uses the source to check trusted patterns; for local
 * audits we provide the manifest's URI when available.
 */
function buildSourceFromManifest(pkg: ManifestV2Package | undefined): GitSource {
  if (!pkg || pkg.source.type !== 'git') {
    return FALLBACK_SOURCE
  }

  const { source } = pkg
  const parts = source.uri.split('/')
  return {
    host: (parts[0] ?? 'github.com') as GitSource['host'],
    owner: parts[1] ?? 'unknown',
    repo: parts[2] ?? 'unknown',
    path: source.path,
    ref: source.ref,
    commit: source.commit,
  }
}

async function auditDirectory(
  dirPath: string,
  label: string,
  source: GitSource
): Promise<SecurityScanResult | null> {
  const jsonMode = isJSONMode()
  const spinner = createSpinner(`Scanning ${label}...`).start()

  try {
    const files = await readFilesFromDirectory(dirPath)

    if (files.length === 0) {
      if (jsonMode) {
        return null
      }
      spinner.warn(`No files found at ${dirPath}`)
      return null
    }

    const result = await scanFiles(files, source, { skipAudit: false })

    if (!jsonMode) {
      renderScanResult(result, spinner as ReturnType<typeof ora>)
    } else {
      spinner.stop()
    }

    return result
  } catch (error) {
    const message = `Failed to scan ${label}: ${error instanceof Error ? error.message : String(error)}`
    if (jsonMode) {
      outputError('AUDIT_FAILED', message)
      process.exit(1)
    }
    spinner.fail(message)
    return null
  }
}

export function registerAuditCommand(program: Command): void {
  program
    .command('audit [name]')
    .description('Run a security scan on installed skills or an arbitrary directory')
    .option('--global', 'Scan globally installed packages')
    .option('--path <path>', 'Scan an arbitrary directory instead of installed skills')
    .action(async (name: string | undefined, options: AuditOptions) => {
      const jsonMode = isJSONMode()
      const projectRoot = process.cwd()
      const scope: Scope = options.global ? 'global' : 'project'

      // Scan arbitrary directory
      if (options.path) {
        const targetPath = join(projectRoot, options.path)
        const source: GitSource = {
          host: 'github.com',
          owner: 'local',
          repo: 'audit',
          path: '',
          ref: 'HEAD',
        }

        const scanResult = await auditDirectory(targetPath, options.path, source)
        const hasBlockFinding = scanResult?.verdict === 'BLOCK'

        if (jsonMode) {
          const passed =
            !scanResult || scanResult.verdict === 'PASS' || scanResult.verdict === 'WARN'
          const auditResult: AuditResult = {
            target: options.path,
            passed,
            findings: (scanResult?.findings ?? []).map((f) => ({
              rule: f.category,
              severity: f.severity,
              file: f.file,
              line: f.line ?? 0,
              evidence: f.evidence ?? '',
            })),
          }
          outputSuccess(auditResult)
          if (!passed) {
            process.exitCode = 1
          }
          return
        }

        if (hasBlockFinding) {
          process.exitCode = 1
        }
        return
      }

      const manifest = readManifest(projectRoot, scope)
      const packageNames = (() => {
        if (!name) {
          return Object.keys(manifest.packages)
        }

        const lookup = resolvePackageQuery(manifest.packages, name)
        return lookup.ok ? [lookup.key] : []
      })()

      if (packageNames.length === 0) {
        if (jsonMode) {
          const auditResult: AuditResult = {
            target: name ?? projectRoot,
            passed: true,
            findings: [],
          }
          outputSuccess(auditResult)
          return
        }
        if (name) {
          console.log(chalk.dim(`Package "${name}" is not installed.`))
        } else {
          console.log(chalk.dim('No packages installed. Use --path to scan a directory.'))
        }
        return
      }

      if (!jsonMode) {
        console.log(
          chalk.bold(
            `\nAuditing ${packageNames.length} package${packageNames.length === 1 ? '' : 's'}...\n`
          )
        )
      }

      const allFindings: AuditResult['findings'] = []
      let allPassed = true
      let hasBlockFinding = false

      for (const pkgName of packageNames) {
        const pkg = manifest.packages[pkgName]
        if (!pkg) {
          continue
        }

        const displayName = getDisplayName(pkgName, pkg)
        const shortName = displayName.split('/').pop() ?? displayName
        const canonicalPath = getCanonicalSkillPath(projectRoot, shortName, scope)
        const source = buildSourceFromManifest(pkg)

        const scanResult = await auditDirectory(canonicalPath, displayName, source)

        if (jsonMode && scanResult) {
          if (scanResult.verdict === 'BLOCK') {
            allPassed = false
          }
          for (const f of scanResult.findings) {
            allFindings.push({
              rule: f.category,
              severity: f.severity,
              file: f.file,
              line: f.line ?? 0,
              evidence: f.evidence ?? '',
            })
          }
        }

        if (scanResult?.verdict === 'BLOCK') {
          hasBlockFinding = true
        }
      }

      if (jsonMode) {
        const auditResult: AuditResult = {
          target: name ?? projectRoot,
          passed: allPassed,
          findings: allFindings,
        }
        outputSuccess(auditResult)
      }

      if (hasBlockFinding) {
        process.exitCode = 1
      }
    })
}
