import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import {
  composeConfigs,
  detectInstalledAgents,
  getConfigFilePath,
  isComposedConfig,
  parseComposedSections,
} from '@agentver/agent-definitions'
import type { InstallResult as InstallResultJSON } from '@agentver/shared'
import { AgentverError, type GitSource, type WellKnownSource } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import type ora from 'ora'
import prompts from 'prompts'
import { fetchFiles, parseGitSource, resolveRef } from '../git/index.js'
import type { FetchedFile } from '../git/types.js'
import {
  createSpinner,
  isJSONMode,
  outputError,
  outputSuccess,
  type SpinnerLike,
} from '../output.js'
import { getCredentials } from '../registry/auth.js'
import { readConfig } from '../registry/config.js'
import { reportInstallation } from '../registry/reporter.js'
import { renderScanResult, scanFiles } from '../security/index.js'
import type { ScanResult as SecurityScanResult } from '../security/types.js'
import { createAgentSymlinks, getCanonicalSkillPath } from '../storage/canonical'
import { computeSha256FromFiles } from '../storage/integrity'
import { readLockfile, writeLockfile } from '../storage/lockfile'
import { readManifest, writeManifest } from '../storage/manifest'
import {
  fetchWellKnownIndex,
  fetchWellKnownSkill,
  looksLikeWellKnownUrl,
  parseWellKnownSource,
} from '../wellknown/index.js'

export type InstallOptions = {
  agent?: string
  global?: boolean
  dryRun?: boolean
  path?: string
  detect?: boolean
  skipAudit?: boolean
}

export type InstallResult = {
  name: string
  ref: string
  commitSha: string
  agents: string[]
}

type ResolveResponse = {
  gitUri: string
  gitPath: string
  gitRef: string
  source?: 'git' | 'platform'
  files?: Array<{ path: string; content: string }>
}

type AgentverUri = {
  org: string
  path: string
  ref: string
}

/**
 * Parse an agentver:// protocol URI into its constituent parts.
 *
 * Format: agentver://org-slug/path/to/package@ref
 * Example: agentver://lleverage/skills/google-search-console/SKILL.md@main
 */
export function parseAgentverUri(source: string): AgentverUri | null {
  if (!source.startsWith('agentver://')) return null

  const withoutProtocol = source.slice('agentver://'.length)
  const atIndex = withoutProtocol.lastIndexOf('@')

  let pathPart: string
  let ref: string

  if (atIndex > 0) {
    pathPart = withoutProtocol.slice(0, atIndex)
    ref = withoutProtocol.slice(atIndex + 1)
  } else {
    pathPart = withoutProtocol
    ref = ''
  }

  const segments = pathPart.split('/').filter(Boolean)
  if (segments.length < 1) return null

  return {
    org: segments[0]!,
    path: segments.slice(1).join('/'),
    ref,
  }
}

function buildAuditData(scanResult?: SecurityScanResult): InstallResultJSON['audit'] {
  if (!scanResult) {
    return { passed: true, findings: 0, blockers: 0 }
  }
  const blockers = scanResult.findings.filter(
    (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH'
  ).length
  return {
    passed: scanResult.verdict !== 'BLOCK',
    findings: scanResult.findings.length,
    blockers,
  }
}

function looksLikeGitUrl(source: string): boolean {
  const cleaned = source
    .replace(/^https?:\/\//, '')
    .split('@')[0]!
    .split('#')[0]!
  const segments = cleaned.split('/').filter(Boolean)
  return segments.length >= 3 && segments[0]!.includes('.')
}

async function fetchFromPlatform<T>(platformUrl: string, path: string): Promise<T> {
  const credentials = await getCredentials()

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (credentials?.token) {
    headers.Authorization = `Bearer ${credentials.token}`
  } else if (credentials?.apiKey) {
    headers['X-API-Key'] = credentials.apiKey
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(`${platformUrl}/api/v1${path}`, {
      headers,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new AgentverError('NOT_FOUND', `Platform could not resolve "${path}"`)
    }

    return response.json() as Promise<T>
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof AgentverError) throw error
    throw new AgentverError('INTERNAL_ERROR', `Platform request failed: ${String(error)}`)
  }
}

async function installFromWellKnown(
  source: string,
  options: InstallOptions
): Promise<InstallResult> {
  const jsonMode = isJSONMode()
  const spinner = createSpinner(`Resolving well-known source: ${source}`).start()

  try {
    const { baseUrl, skillName } = parseWellKnownSource(source)
    const hostname = new URL(baseUrl).hostname

    spinner.text = `Fetching well-known index from ${hostname}...`
    const index = await fetchWellKnownIndex(baseUrl)

    let selectedEntry = index.skills[0]!

    if (skillName) {
      const found = index.skills.find((s) => s.name === skillName)
      if (!found) {
        const available = index.skills.map((s) => s.name).join(', ')
        if (jsonMode) {
          outputError(
            'NOT_FOUND',
            `Skill "${skillName}" not found at ${hostname}. Available: ${available}`
          )
          process.exit(1)
        }
        spinner.fail(`Skill "${skillName}" not found at ${hostname}. Available: ${available}`)
        process.exit(1)
      }
      selectedEntry = found
    } else if (index.skills.length > 1) {
      if (jsonMode) {
        outputError(
          'AMBIGUOUS_SKILL',
          `Multiple skills available at ${hostname}: ${index.skills.map((s) => s.name).join(', ')}. Specify a skill name.`
        )
        process.exit(1)
      }
      spinner.stop()
      process.stdout.write(chalk.bold(`\nMultiple skills available at ${hostname}:\n\n`))
      for (const skill of index.skills) {
        process.stdout.write(
          `  ${chalk.green(skill.name)} ${chalk.dim(`— ${skill.description}`)}\n`
        )
      }
      process.stdout.write(
        `\n${chalk.dim('Specify a skill:')} ${chalk.white(`agentver install ${hostname}/<skill-name>`)}\n`
      )
      process.exit(1)
    }

    spinner.text = `Fetching files for ${selectedEntry.name} from ${hostname}...`
    const fetchResult = await fetchWellKnownSkill(baseUrl, selectedEntry)

    if (fetchResult.files.length === 0) {
      if (jsonMode) {
        outputError(
          'NO_FILES',
          `No files fetched for skill "${selectedEntry.name}" from ${hostname}`
        )
        process.exit(1)
      }
      spinner.fail(`No files fetched for skill "${selectedEntry.name}" from ${hostname}`)
      process.exit(1)
    }

    const integrity = computeSha256FromFiles(fetchResult.files)

    const projectRoot = process.cwd()
    let agents: string[] = []
    const scope = options.global ? 'global' : 'project'

    if (options.path) {
      await installToCustomPath(selectedEntry.name, fetchResult.files, options, spinner)
      agents = options.agent ? [options.agent] : []
    } else {
      if (options.detect === false && !options.agent) {
        if (jsonMode) {
          outputError(
            'VALIDATION_ERROR',
            'Use --agent to specify a target agent when --no-detect is enabled'
          )
          process.exit(1)
        }
        spinner.fail('Use --agent to specify a target agent when --no-detect is enabled')
        process.exit(1)
      }

      agents = options.agent
        ? [options.agent]
        : options.detect === false
          ? []
          : detectInstalledAgents(projectRoot).map((a) => a.id)

      if (agents.length === 0) {
        if (jsonMode) {
          outputSuccess<InstallResultJSON>(
            {
              name: selectedEntry.name,
              source: { type: 'well-known', baseUrl },
              agents: [],
              path: '',
              scope,
              audit: buildAuditData(),
            },
            ['No agents detected. Use --agent to specify one.']
          )
        } else {
          spinner.warn('No agents detected. Use --agent to specify one.')
        }
        return { name: selectedEntry.name, ref: 'well-known', commitSha: '', agents: [] }
      }

      const packageType = detectPackageType(fetchResult.files)

      if (packageType === 'AGENT_CONFIG') {
        await installAgentConfig(selectedEntry.name, fetchResult.files, agents, options, spinner)
      } else {
        await installStandardPackage(
          selectedEntry.name,
          fetchResult.files,
          agents,
          options,
          spinner
        )
      }
    }

    if (options.dryRun) {
      if (jsonMode) {
        const installPath = options.path
          ? resolve(projectRoot, options.path)
          : getCanonicalSkillPath(projectRoot, selectedEntry.name, scope)
        outputSuccess<InstallResultJSON>({
          name: selectedEntry.name,
          source: { type: 'well-known', baseUrl },
          agents,
          path: installPath,
          scope,
          audit: buildAuditData(),
        })
      }
      return { name: selectedEntry.name, ref: 'well-known', commitSha: '', agents }
    }

    const wellKnownSourceRecord: WellKnownSource = {
      type: 'well-known',
      baseUrl,
      hostname,
      skillName: selectedEntry.name,
    }

    const manifest = readManifest(projectRoot)
    manifest.packages[selectedEntry.name] = {
      source: wellKnownSourceRecord,
      agents,
      installedAt: new Date().toISOString(),
      modified: false,
    }
    writeManifest(projectRoot, manifest)

    const lockfile = readLockfile(projectRoot)
    lockfile.packages[selectedEntry.name] = {
      source: wellKnownSourceRecord,
      integrity,
      agents,
    }
    writeLockfile(projectRoot, lockfile)

    const target = options.path ?? agents.join(', ')

    if (jsonMode) {
      const installPath = options.path
        ? resolve(projectRoot, options.path)
        : getCanonicalSkillPath(projectRoot, selectedEntry.name, scope)
      outputSuccess<InstallResultJSON>({
        name: selectedEntry.name,
        source: { type: 'well-known', baseUrl },
        agents,
        path: installPath,
        scope,
        audit: buildAuditData(),
      })
    } else {
      spinner.succeed(
        `Installed ${chalk.green(selectedEntry.name)} from ${chalk.dim(hostname)} ${chalk.dim('(well-known)')} to ${target}`
      )
    }

    return { name: selectedEntry.name, ref: 'well-known', commitSha: '', agents }
  } catch (error) {
    if (jsonMode) {
      outputError('INSTALL_FAILED', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    spinner.fail(`Failed to install: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

async function installFromPlatform(
  parsed: AgentverUri,
  options: InstallOptions
): Promise<InstallResult> {
  const jsonMode = isJSONMode()
  const displayName = parsed.path ? `${parsed.org}/${parsed.path}` : parsed.org
  const spinner = createSpinner(`Resolving ${displayName}`).start()

  try {
    const config = readConfig()
    if (!config.platformUrl) {
      throw new AgentverError(
        'VALIDATION_ERROR',
        'Agentver URIs require a platform connection. Run:\n  agentver login'
      )
    }

    const resolveName = parsed.path ? `${parsed.org}/${parsed.path}` : parsed.org
    spinner.text = `Resolving ${resolveName} via platform...`

    const resolved = await fetchFromPlatform<ResolveResponse>(
      config.platformUrl,
      `/resolve?name=${encodeURIComponent(resolveName)}`
    )

    // Git-backed package — delegate to the standard git install flow
    if (resolved.source !== 'platform') {
      let fullSource = resolved.gitPath ? `${resolved.gitUri}/${resolved.gitPath}` : resolved.gitUri

      if (parsed.ref) {
        fullSource += `@${parsed.ref}`
      } else if (resolved.gitRef) {
        fullSource += `@${resolved.gitRef}`
      }

      spinner.stop()
      return installPackage(fullSource, options)
    }

    // Platform-hosted but no files returned — the platform failed to fetch them
    if (!resolved.files?.length) {
      throw new AgentverError(
        'NOT_FOUND',
        `Package "${displayName}" is hosted on the platform but no files were returned. The platform may be experiencing issues — try again later.`
      )
    }

    // Platform-hosted package — install directly from response files
    const files: FetchedFile[] = resolved.files.map((f) => ({
      path: f.path,
      content: f.content,
      size: new TextEncoder().encode(f.content).length,
    }))

    if (files.length === 0) {
      if (jsonMode) {
        outputError('NO_FILES', `No files found for ${displayName}`)
        process.exit(1)
      }
      spinner.fail(`No files found for ${displayName}`)
      process.exit(1)
    }

    const shortName = deriveSkillName({
      path: resolved.gitPath ?? '',
      repo: parsed.org,
    })
    const ref = parsed.ref || resolved.gitRef || 'main'

    let securityScanResult: SecurityScanResult | undefined

    if (!options.skipAudit) {
      spinner.text = 'Running security scan...'
      const scanSource = {
        host: 'generic' as const,
        owner: parsed.org,
        repo: shortName,
        path: resolved.gitPath ?? '',
        ref,
      }
      securityScanResult = await scanFiles(files, scanSource, {
        skipAudit: options.skipAudit,
      })

      if (securityScanResult.verdict === 'BLOCK') {
        if (jsonMode) {
          outputError(
            'SECURITY_BLOCK',
            `Security scan blocked installation: ${securityScanResult.findings.length} finding(s)`
          )
          process.exit(1)
        }
        renderScanResult(securityScanResult, spinner as ReturnType<typeof ora>)
        process.exit(1)
      }

      if (securityScanResult.verdict === 'WARN') {
        if (jsonMode) {
          // In JSON mode, proceed with warnings (no interactive prompt)
        } else {
          renderScanResult(securityScanResult, spinner as ReturnType<typeof ora>)
          const { proceed } = await prompts({
            type: 'confirm',
            name: 'proceed',
            message: 'Continue with installation despite warnings?',
            initial: false,
          })

          if (!proceed) {
            console.log(chalk.dim('Installation cancelled.'))
            process.exit(0)
          }

          spinner.start('Continuing installation...')
        }
      } else {
        if (!jsonMode) {
          spinner.succeed(chalk.green('Security scan passed'))
          spinner.start('Installing...')
        }
      }
    }

    const integrity = computeSha256FromFiles(files)
    const projectRoot = process.cwd()
    const scope = options.global ? 'global' : 'project'
    const sourceUri = `agentver://${parsed.org}`
    let agents: string[] = []

    if (options.path) {
      await installToCustomPath(shortName, files, options, spinner)
      agents = options.agent ? [options.agent] : []
    } else {
      if (options.detect === false && !options.agent) {
        if (jsonMode) {
          outputError(
            'VALIDATION_ERROR',
            'Use --agent to specify a target agent when --no-detect is enabled'
          )
          process.exit(1)
        }
        spinner.fail('Use --agent to specify a target agent when --no-detect is enabled')
        process.exit(1)
      }

      agents = options.agent
        ? [options.agent]
        : options.detect === false
          ? []
          : detectInstalledAgents(projectRoot).map((a) => a.id)

      if (agents.length === 0) {
        if (jsonMode) {
          outputSuccess<InstallResultJSON>(
            {
              name: shortName,
              source: { type: 'git', uri: sourceUri },
              agents: [],
              path: '',
              scope,
              audit: buildAuditData(securityScanResult),
            },
            ['No agents detected. Use --agent to specify one.']
          )
        } else {
          spinner.warn('No agents detected. Use --agent to specify one.')
        }
        return { name: shortName, ref, commitSha: '', agents: [] }
      }

      const packageType = detectPackageType(files)

      if (packageType === 'AGENT_CONFIG') {
        await installAgentConfig(shortName, files, agents, options, spinner)
      } else {
        await installStandardPackage(shortName, files, agents, options, spinner)
      }
    }

    if (options.dryRun) {
      if (jsonMode) {
        const installPath = options.path
          ? resolve(projectRoot, options.path)
          : getCanonicalSkillPath(projectRoot, shortName, scope)
        outputSuccess<InstallResultJSON>({
          name: shortName,
          source: { type: 'git', uri: sourceUri },
          agents,
          path: installPath,
          scope,
          audit: buildAuditData(securityScanResult),
        })
      }
      return { name: shortName, ref, commitSha: '', agents }
    }

    const gitSourceRecord: GitSource = {
      type: 'git',
      uri: sourceUri,
      path: resolved.gitPath ?? '',
      ref,
      commit: '',
    }

    const manifest = readManifest(projectRoot)
    manifest.packages[shortName] = {
      source: gitSourceRecord,
      agents,
      installedAt: new Date().toISOString(),
      modified: false,
    }
    writeManifest(projectRoot, manifest)

    const lockfile = readLockfile(projectRoot)
    lockfile.packages[shortName] = {
      source: gitSourceRecord,
      integrity,
      agents,
    }
    writeLockfile(projectRoot, lockfile)

    const target = options.path ?? agents.join(', ')

    const warnings: string[] = []
    if (securityScanResult?.verdict === 'WARN') {
      warnings.push(`Security scan passed with ${securityScanResult.findings.length} warning(s)`)
    }

    if (jsonMode) {
      const installPath = options.path
        ? resolve(projectRoot, options.path)
        : getCanonicalSkillPath(projectRoot, shortName, scope)
      outputSuccess<InstallResultJSON>(
        {
          name: shortName,
          source: { type: 'git', uri: sourceUri },
          agents,
          path: installPath,
          scope,
          audit: buildAuditData(securityScanResult),
        },
        warnings.length > 0 ? warnings : undefined
      )
    } else {
      spinner.succeed(
        `Installed ${chalk.green(shortName)} from ${chalk.dim(sourceUri)} ${chalk.cyan(`@${ref}`)} to ${target}`
      )
    }

    return { name: shortName, ref, commitSha: '', agents }
  } catch (error) {
    if (jsonMode) {
      outputError('INSTALL_FAILED', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    spinner.fail(`Failed to install: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

export async function installPackage(
  source: string,
  options: InstallOptions
): Promise<InstallResult> {
  if (looksLikeWellKnownUrl(source)) {
    return installFromWellKnown(source, options)
  }

  const agentverUri = parseAgentverUri(source)
  if (agentverUri) {
    return installFromPlatform(agentverUri, options)
  }

  // Short names (org/package) need platform resolution — route through
  // installFromPlatform which handles both platform-hosted and git-backed packages
  if (!looksLikeGitUrl(source)) {
    const jsonMode = isJSONMode()
    const config = readConfig()

    if (!config.platformUrl) {
      const message = `"${source}" doesn't look like a Git URL. Connect to a platform to resolve short names:\n  agentver login`
      if (jsonMode) {
        outputError('VALIDATION_ERROR', message)
      } else {
        const spinner = createSpinner('Resolving').start()
        spinner.fail(message)
      }
      process.exit(1)
    }

    const [namePart, ref] = source.split('@')
    const segments = namePart!.split('/').filter(Boolean)

    if (segments.length < 2) {
      const message = `Invalid package name "${source}" — expected format: org/package-name`
      if (jsonMode) {
        outputError('VALIDATION_ERROR', message)
      } else {
        const spinner = createSpinner('Resolving').start()
        spinner.fail(message)
      }
      process.exit(1)
    }

    return installFromPlatform(
      { org: segments[0]!, path: segments.slice(1).join('/'), ref: ref ?? '' },
      options
    )
  }

  const jsonMode = isJSONMode()
  const spinner = createSpinner(`Parsing source: ${source}`).start()

  try {
    const gitSource = parseGitSource(source)
    const shortName = deriveSkillName(gitSource)

    spinner.text = `Resolving ${gitSource.owner}/${gitSource.repo}@${gitSource.ref}`
    const resolved = await resolveRef(gitSource)

    spinner.text = `Fetching files from ${gitSource.host}/${gitSource.owner}/${gitSource.repo}`
    const result = await fetchFiles(resolved)

    if (result.files.length === 0) {
      if (jsonMode) {
        outputError('NO_FILES', `No files found at ${formatSource(gitSource)}`)
        process.exit(1)
      }
      spinner.fail(`No files found at ${formatSource(gitSource)}`)
      process.exit(1)
    }

    let securityScanResult: SecurityScanResult | undefined

    if (!options.skipAudit) {
      spinner.text = 'Running security scan...'
      const scanResult = await scanFiles(result.files, gitSource, {
        skipAudit: options.skipAudit,
      })
      securityScanResult = scanResult

      if (scanResult.verdict === 'BLOCK') {
        if (jsonMode) {
          outputError(
            'SECURITY_BLOCK',
            `Security scan blocked installation: ${scanResult.findings.length} finding(s)`
          )
          process.exit(1)
        }
        renderScanResult(scanResult, spinner as ReturnType<typeof ora>)
        process.exit(1)
      }

      if (scanResult.verdict === 'WARN') {
        if (jsonMode) {
          // In JSON mode, proceed with warnings (no interactive prompt)
        } else {
          renderScanResult(scanResult, spinner as ReturnType<typeof ora>)
          const { proceed } = await prompts({
            type: 'confirm',
            name: 'proceed',
            message: 'Continue with installation despite warnings?',
            initial: false,
          })

          if (!proceed) {
            console.log(chalk.dim('Installation cancelled.'))
            process.exit(0)
          }

          spinner.start('Continuing installation...')
        }
      } else {
        if (!jsonMode) {
          spinner.succeed(chalk.green('Security scan passed'))
          spinner.start('Installing...')
        }
      }
    }

    const integrity = computeSha256FromFiles(result.files)

    const projectRoot = process.cwd()
    const scope = options.global ? 'global' : 'project'
    const gitUri = `${gitSource.host}/${gitSource.owner}/${gitSource.repo}`
    let agents: string[] = []

    if (options.path) {
      await installToCustomPath(shortName, result.files, options, spinner)
      agents = options.agent ? [options.agent] : []
    } else {
      if (options.detect === false && !options.agent) {
        if (jsonMode) {
          outputError(
            'VALIDATION_ERROR',
            'Use --agent to specify a target agent when --no-detect is enabled'
          )
          process.exit(1)
        }
        spinner.fail('Use --agent to specify a target agent when --no-detect is enabled')
        process.exit(1)
      }

      agents = options.agent
        ? [options.agent]
        : options.detect === false
          ? []
          : detectInstalledAgents(projectRoot).map((a) => a.id)

      if (agents.length === 0) {
        if (jsonMode) {
          outputSuccess<InstallResultJSON>(
            {
              name: shortName,
              source: { type: 'git', uri: gitUri },
              agents: [],
              path: '',
              scope,
              audit: buildAuditData(securityScanResult),
            },
            ['No agents detected. Use --agent to specify one.']
          )
        } else {
          spinner.warn('No agents detected. Use --agent to specify one.')
        }
        return { name: shortName, ref: gitSource.ref, commitSha: resolved.commitSha, agents: [] }
      }

      const packageType = detectPackageType(result.files)

      if (packageType === 'AGENT_CONFIG') {
        await installAgentConfig(shortName, result.files, agents, options, spinner)
      } else {
        await installStandardPackage(shortName, result.files, agents, options, spinner)
      }
    }

    if (options.dryRun) {
      if (jsonMode) {
        const installPath = options.path
          ? resolve(projectRoot, options.path)
          : getCanonicalSkillPath(projectRoot, shortName, scope)
        outputSuccess<InstallResultJSON>({
          name: shortName,
          source: { type: 'git', uri: gitUri },
          agents,
          path: installPath,
          scope,
          audit: buildAuditData(securityScanResult),
        })
      }
      return { name: shortName, ref: gitSource.ref, commitSha: resolved.commitSha, agents }
    }

    const gitSourceRecord: GitSource = {
      type: 'git',
      uri: gitUri,
      path: gitSource.path,
      ref: gitSource.ref,
      commit: resolved.commitSha,
    }

    const manifest = readManifest(projectRoot)
    manifest.packages[shortName] = {
      source: gitSourceRecord,
      agents,
      installedAt: new Date().toISOString(),
      modified: false,
    }
    writeManifest(projectRoot, manifest)

    const lockfile = readLockfile(projectRoot)
    lockfile.packages[shortName] = {
      source: gitSourceRecord,
      integrity,
      agents,
    }
    writeLockfile(projectRoot, lockfile)

    reportInstallation(shortName, gitSourceRecord, agents, resolved.commitSha)

    const target = options.path ?? agents.join(', ')
    const installPath = options.path
      ? resolve(projectRoot, options.path)
      : getCanonicalSkillPath(projectRoot, shortName, scope)

    const warnings: string[] = []
    if (securityScanResult?.verdict === 'WARN') {
      warnings.push(`Security scan passed with ${securityScanResult.findings.length} warning(s)`)
    }

    if (jsonMode) {
      outputSuccess<InstallResultJSON>(
        {
          name: shortName,
          source: { type: 'git', uri: gitUri },
          agents,
          path: installPath,
          scope,
          audit: buildAuditData(securityScanResult),
        },
        warnings.length > 0 ? warnings : undefined
      )
    } else {
      spinner.succeed(
        `Installed ${chalk.green(shortName)} from ${chalk.dim(formatSource(gitSource))} ${chalk.cyan(`@${gitSource.ref}`)} ${chalk.dim(`(${resolved.commitSha.slice(0, 7)})`)} to ${target}`
      )
    }

    return { name: shortName, ref: gitSource.ref, commitSha: resolved.commitSha, agents }
  } catch (error) {
    if (jsonMode) {
      outputError('INSTALL_FAILED', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    spinner.fail(`Failed to install: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

function deriveSkillName(source: { path: string; repo: string }): string {
  if (source.path) {
    const parts = source.path.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? source.repo
  }
  return source.repo
}

function formatSource(source: { host: string; owner: string; repo: string; path: string }): string {
  const base = `${source.host}/${source.owner}/${source.repo}`
  return source.path ? `${base}/${source.path}` : base
}

function detectPackageType(files: FetchedFile[]): string {
  const filenames = new Set(files.map((f) => f.path))

  if (filenames.has('SKILL.md')) return 'SKILL'
  if (filenames.has('plugin.json')) return 'PLUGIN'
  if (filenames.has('script.json')) return 'SCRIPT'
  if (filenames.has('PROMPT.md')) return 'PROMPT'

  const configFiles = [
    'CLAUDE.md',
    'AGENTS.md',
    '.cursorrules',
    '.windsurfrules',
    '.github/copilot-instructions.md',
    '.junie/guidelines.md',
  ]
  for (const cf of configFiles) {
    if (filenames.has(cf)) return 'AGENT_CONFIG'
  }

  return 'SKILL'
}

async function installAgentConfig(
  name: string,
  files: FetchedFile[],
  agents: string[],
  options: InstallOptions,
  spinner: ReturnType<typeof ora> | SpinnerLike
): Promise<void> {
  const projectRoot = process.cwd()

  if (options.dryRun) {
    spinner.info(
      `${chalk.yellow('[dry-run]')} Would install agent config ${chalk.green(name)} to ${agents.join(', ')}`
    )
    return
  }

  spinner.text = `Installing agent config to ${agents.length} agent(s)...`

  const contentFile = files.find(
    (f) =>
      f.path === 'CLAUDE.md' ||
      f.path === 'AGENTS.md' ||
      f.path === '.cursorrules' ||
      f.path === '.windsurfrules' ||
      f.path.endsWith('.md')
  )

  if (!contentFile) {
    spinner.fail('No config content file found in package')
    process.exit(1)
  }

  const configContent = contentFile.content

  for (const agentId of agents) {
    const configPath = getConfigFilePath(agentId as Parameters<typeof getConfigFilePath>[0], name)
    if (!configPath) continue

    const fullConfigPath = options.global
      ? configPath.replace('~', homedir())
      : join(projectRoot, configPath)

    const configDir = join(fullConfigPath, '..')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }

    let finalContent = configContent
    if (existsSync(fullConfigPath)) {
      const existingContent = readFileSync(fullConfigPath, 'utf-8')

      if (isComposedConfig(existingContent)) {
        const existingSections = parseComposedSections(existingContent)
        const alreadyPresent = existingSections.some((s) => s.packageName === name)

        if (!alreadyPresent) {
          const allConfigs = [
            ...existingSections.map((s, idx) => ({
              packageName: s.packageName,
              content: s.content,
              order: idx,
            })),
            {
              packageName: name,
              content: contentFile.content,
              order: existingSections.length,
            },
          ]
          const composed = composeConfigs(allConfigs)
          finalContent = composed.content
        }
      }
    }

    writeFileSync(fullConfigPath, finalContent, 'utf-8')
  }
}

async function installToCustomPath(
  name: string,
  files: FetchedFile[],
  options: InstallOptions,
  spinner: ReturnType<typeof ora> | SpinnerLike
): Promise<void> {
  const targetPath = resolve(process.cwd(), options.path!)

  if (options.dryRun) {
    spinner.info(
      `${chalk.yellow('[dry-run]')} Would install ${chalk.green(name)} to ${chalk.dim(targetPath)}`
    )
    console.log(chalk.dim(`  Files: ${files.map((f) => f.path).join(', ')}`))
    return
  }

  spinner.text = `Installing to ${targetPath}...`

  if (!existsSync(targetPath)) {
    mkdirSync(targetPath, { recursive: true })
  }

  for (const file of files) {
    const resolvedFilePath = resolve(targetPath, file.path)
    const relativePath = relative(targetPath, resolvedFilePath)
    if (relativePath.startsWith('..') || resolve(resolvedFilePath) !== resolvedFilePath) {
      continue
    }

    const dir = join(resolvedFilePath, '..')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(resolvedFilePath, file.content, 'utf-8')
  }
}

async function installStandardPackage(
  name: string,
  files: FetchedFile[],
  agents: string[],
  options: InstallOptions,
  spinner: ReturnType<typeof ora> | SpinnerLike
): Promise<void> {
  const projectRoot = process.cwd()
  const scope = options.global ? 'global' : 'project'

  if (options.dryRun) {
    const canonicalPath = getCanonicalSkillPath(projectRoot, name, scope)
    spinner.info(
      `${chalk.yellow('[dry-run]')} Would install ${chalk.green(name)} to ${chalk.dim(canonicalPath)}`
    )
    console.log(chalk.dim(`  Files: ${files.map((f) => f.path).join(', ')}`))
    console.log(chalk.dim(`  Symlinks: ${agents.join(', ')}`))
    return
  }

  spinner.text = `Installing to canonical path and symlinking to ${agents.length} agent(s)...`

  // Step 1: Write files to canonical directory
  const canonicalPath = getCanonicalSkillPath(projectRoot, name, scope)

  if (!existsSync(canonicalPath)) {
    mkdirSync(canonicalPath, { recursive: true })
  }

  for (const file of files) {
    const resolvedFilePath = resolve(canonicalPath, file.path)
    const relativePath = relative(canonicalPath, resolvedFilePath)
    if (relativePath.startsWith('..') || resolve(resolvedFilePath) !== resolvedFilePath) {
      continue
    }

    const dir = dirname(resolvedFilePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(resolvedFilePath, file.content, 'utf-8')
  }

  // Step 2: Create symlinks from each agent's skill path to the canonical directory
  createAgentSymlinks(projectRoot, name, agents, scope)
}

export function registerInstallCommand(program: Command): void {
  program
    .command('install <source>')
    .description('Install a skill from a Git repository or well-known domain')
    .option('--agent <agent>', 'Target specific agent')
    .option('--global', 'Install globally')
    .option('--dry-run', 'Show what would be installed without making changes')
    .option('--path <path>', 'Override placement path (relative to cwd or absolute)')
    .option('--no-detect', 'Skip agent auto-detection (requires --agent)')
    .option('--skip-audit', 'Skip the security scan')
    .action(async (source: string, options: InstallOptions) => {
      await installPackage(source, options)
    })
}
