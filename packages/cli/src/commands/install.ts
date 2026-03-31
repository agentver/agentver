import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  type AgentId,
  composeConfigs,
  detectInstalledAgents,
  getAgentPlacementPath,
  getCommandPlacementPath,
  getConfigFilePath,
  getGlobalConfigFilePath,
  isComposedConfig,
  parseComposedSections,
  translateConfig,
} from '@agentver/agent-definitions'
import type { InstallResult as InstallResultJSON } from '@agentver/shared'
import {
  AGENT_CONFIG_FILES,
  AgentverError,
  type BundleInstallResult,
  type GitSource,
  type LockfileV2,
  type ManifestV2,
  PACKAGE_STRUCTURES,
  type PackageSource,
  type WellKnownSource,
} from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import type ora from 'ora'
import prompts from 'prompts'
import { installBundleFromFiles } from '../bundle/index.js'
import {
  enforceConflicts,
  enforceDependencies,
  extractDependencyMetadata,
} from '../dependency-check.js'
import { fetchFiles, parseGitSource, resolveRef } from '../git/index.js'
import type { FetchedFile, ResolvedRef } from '../git/types.js'
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
import { readManifest } from '../storage/manifest'
import { updateManifestAndLockfile } from '../storage/pair'
import { resolvePlacementPath } from '../utils/paths'
import { extractError } from '../utils.js'
import {
  fetchWellKnownIndex,
  fetchWellKnownSkill,
  looksLikeWellKnownUrl,
  parseWellKnownSource,
} from '../wellknown/index.js'

const toAgentList = (agent?: string | string[]): string[] =>
  agent ? (Array.isArray(agent) ? agent : [agent]) : []

export type InstallOptions = {
  agent?: string | string[]
  global?: boolean
  dryRun?: boolean
  yes?: boolean
  path?: string
  detect?: boolean
  skipAudit?: boolean
  type?: 'agent' | 'command'
  persist?: boolean
}

export type InstallResult = {
  name: string
  ref: string
  commitSha: string
  agents: string[]
  manifestEntry?: ManifestV2['packages'][string]
  lockfileEntry?: LockfileV2['packages'][string]
}

type InstalledPackageType = NonNullable<ManifestV2['packages'][string]['packageType']>

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

/**
 * Derive a synthetic 40-char hex commit SHA from an integrity hash.
 *
 * Platform-hosted packages have no real git commit, but the manifest schema
 * requires a valid commit string (min 7 chars). We produce a deterministic
 * SHA-1 hex digest from the integrity value so downstream commands that
 * display or compare commit hashes work correctly.
 */
export function deriveCommitFromIntegrity(integrity: string): string {
  return createHash('sha1').update(integrity).digest('hex')
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

function recordInstalledPackage(
  projectRoot: string,
  scope: 'project' | 'global',
  name: string,
  manifestEntry: ManifestV2['packages'][string],
  lockfileEntry: LockfileV2['packages'][string]
): void {
  updateManifestAndLockfile(projectRoot, scope, (manifest, lockfile) => {
    manifest.packages[name] = manifestEntry
    lockfile.packages[name] = lockfileEntry
    return { manifest, lockfile }
  })
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
        const msg = `Skill "${skillName}" not found at ${hostname}. Available: ${available}`
        if (!jsonMode) spinner.fail(msg)
        throw new AgentverError('NOT_FOUND', msg)
      }
      selectedEntry = found
    } else if (index.skills.length > 1) {
      if (!jsonMode) {
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
      }
      throw new AgentverError(
        'AMBIGUOUS_SKILL',
        `Multiple skills available at ${hostname}: ${index.skills.map((s) => s.name).join(', ')}. Specify a skill name.`
      )
    }

    spinner.text = `Fetching files for ${selectedEntry.name} from ${hostname}...`
    const fetchResult = await fetchWellKnownSkill(baseUrl, selectedEntry)

    if (fetchResult.files.length === 0) {
      const msg = `No files fetched for skill "${selectedEntry.name}" from ${hostname}`
      if (!jsonMode) spinner.fail(msg)
      throw new AgentverError('NO_FILES', msg)
    }

    const integrity = computeSha256FromFiles(fetchResult.files)

    const projectRoot = process.cwd()
    const requestedAgents = toAgentList(options.agent)
    let agents: string[] = []
    let detectedWkType: InstalledPackageType | undefined
    let installedWkEntryFile: string | undefined
    const scope = options.global ? 'global' : 'project'

    // Enforce dependsOn / conflictsWith before installing
    const depMeta = extractDependencyMetadata(fetchResult.files)
    const currentManifest = readManifest(projectRoot, scope)
    enforceDependencies(depMeta.dependsOn, currentManifest, selectedEntry.name)
    enforceConflicts(depMeta.conflictsWith, currentManifest, selectedEntry.name)

    if (options.path) {
      await installToCustomPath(selectedEntry.name, fetchResult.files, options, spinner)
      agents = requestedAgents
    } else {
      if (options.detect === false && requestedAgents.length === 0) {
        const msg = 'Use --agent to specify a target agent when --no-detect is enabled'
        if (!jsonMode) spinner.fail(msg)
        throw new AgentverError('VALIDATION_ERROR', msg)
      }

      agents =
        requestedAgents.length > 0
          ? requestedAgents
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

      detectedWkType = detectPackageType(fetchResult.files, options.type)

      if (detectedWkType === 'BUNDLE') {
        const wellKnownSourceRecord: WellKnownSource = {
          type: 'well-known',
          baseUrl,
          hostname,
          skillName: selectedEntry.name,
        }
        return installBundleFlow(selectedEntry.name, fetchResult.files, agents, options, spinner, {
          sourceRecord: wellKnownSourceRecord,
          integrity,
          jsonMode,
          projectRoot,
          scope: scope as 'project' | 'global',
          ref: 'well-known',
          commitSha: '',
        })
      } else if (detectedWkType === 'AGENT_CONFIG') {
        await installAgentConfig(selectedEntry.name, fetchResult.files, agents, options, spinner)
      } else if (detectedWkType === 'AGENT' || detectedWkType === 'COMMAND') {
        installedWkEntryFile = await installSingleFilePackage(
          selectedEntry.name,
          fetchResult.files,
          agents,
          detectedWkType,
          options,
          spinner
        )
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

    const manifestEntry = {
      source: wellKnownSourceRecord,
      agents,
      installedAt: new Date().toISOString(),
      modified: false,
      ...(options.path ? { path: resolve(projectRoot, options.path) } : {}),
      ...(detectedWkType === 'AGENT' || detectedWkType === 'COMMAND'
        ? { packageType: detectedWkType, entryFile: installedWkEntryFile }
        : {}),
      ...(depMeta.dependsOn.length > 0 ? { dependsOn: depMeta.dependsOn } : {}),
      ...(depMeta.conflictsWith.length > 0 ? { conflictsWith: depMeta.conflictsWith } : {}),
    }

    const wkSingleFileIntegrity =
      installedWkEntryFile && (detectedWkType === 'AGENT' || detectedWkType === 'COMMAND')
        ? computeSha256FromFiles([
            {
              path: installedWkEntryFile,
              content:
                fetchResult.files.find(
                  (f) => (f.path.split('/').pop() ?? f.path) === installedWkEntryFile
                )?.content ?? '',
            },
          ])
        : integrity

    const lockfileEntry = {
      source: wellKnownSourceRecord,
      integrity: wkSingleFileIntegrity,
      agents,
    }
    if (options.persist !== false) {
      recordInstalledPackage(
        projectRoot,
        scope as 'project' | 'global',
        selectedEntry.name,
        manifestEntry,
        lockfileEntry
      )
    }

    const target = options.path ?? agents.join(', ')
    const scopeLabel = scope === 'global' ? 'user' : 'project'

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
        `Installed ${chalk.green(selectedEntry.name)} ${chalk.dim(`(${scopeLabel})`)} from ${chalk.dim(hostname)} ${chalk.dim('(well-known)')} to ${target}`
      )
    }

    return {
      name: selectedEntry.name,
      ref: 'well-known',
      commitSha: '',
      agents,
      manifestEntry,
      lockfileEntry,
    }
  } catch (error) {
    if (error instanceof AgentverError) throw error
    const { code, message } = extractError(error, 'INSTALL_FAILED')
    if (!jsonMode) spinner.fail(`Failed to install: ${message}`)
    throw new AgentverError(code, message)
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
      const msg = `No files found for ${displayName}`
      if (!jsonMode) spinner.fail(msg)
      throw new AgentverError('NO_FILES', msg)
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
        host: 'local',
        owner: parsed.org,
        repo: shortName,
        path: resolved.gitPath ?? '',
        ref,
      }
      securityScanResult = await scanFiles(files, scanSource, {
        skipAudit: options.skipAudit,
      })

      if (securityScanResult.verdict === 'BLOCK') {
        if (!jsonMode) renderScanResult(securityScanResult, spinner as ReturnType<typeof ora>)
        throw new AgentverError(
          'SECURITY_BLOCK',
          `Security scan blocked installation: ${securityScanResult.findings.length} finding(s)`
        )
      }

      if (securityScanResult.verdict === 'WARN') {
        if (jsonMode) {
          // In JSON mode, proceed with warnings (no interactive prompt)
        } else if (options.yes) {
          spinner.start('Continuing installation...')
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
            throw new AgentverError('CANCELLED', 'Installation cancelled by user')
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
    const syntheticCommit = deriveCommitFromIntegrity(integrity)
    const projectRoot = process.cwd()
    const requestedAgents = toAgentList(options.agent)
    const scope = options.global ? 'global' : 'project'
    const sourceUri = `agentver://${parsed.org}`
    let agents: string[] = []
    let detectedPlatformType: InstalledPackageType | undefined
    let installedPlatformEntryFile: string | undefined

    // Enforce dependsOn / conflictsWith before installing
    const depMeta = extractDependencyMetadata(files)
    const currentManifestForChecks = readManifest(projectRoot, scope)
    enforceDependencies(depMeta.dependsOn, currentManifestForChecks, shortName)
    enforceConflicts(depMeta.conflictsWith, currentManifestForChecks, shortName)

    if (options.path) {
      await installToCustomPath(shortName, files, options, spinner)
      agents = requestedAgents
    } else {
      if (options.detect === false && requestedAgents.length === 0) {
        const msg = 'Use --agent to specify a target agent when --no-detect is enabled'
        if (!jsonMode) spinner.fail(msg)
        throw new AgentverError('VALIDATION_ERROR', msg)
      }

      agents =
        requestedAgents.length > 0
          ? requestedAgents
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
        return { name: shortName, ref, commitSha: syntheticCommit, agents: [] }
      }

      detectedPlatformType = detectPackageType(files, options.type)

      if (detectedPlatformType === 'BUNDLE') {
        const gitSourceRecord: GitSource = {
          type: 'git',
          uri: sourceUri,
          path: resolved.gitPath ?? '',
          ref,
          commit: syntheticCommit,
        }
        return installBundleFlow(shortName, files, agents, options, spinner, {
          sourceRecord: gitSourceRecord,
          integrity,
          securityScanResult,
          jsonMode,
          projectRoot,
          scope,
          ref,
          commitSha: syntheticCommit,
        })
      } else if (detectedPlatformType === 'AGENT_CONFIG') {
        await installAgentConfig(shortName, files, agents, options, spinner)
      } else if (detectedPlatformType === 'AGENT' || detectedPlatformType === 'COMMAND') {
        installedPlatformEntryFile = await installSingleFilePackage(
          shortName,
          files,
          agents,
          detectedPlatformType,
          options,
          spinner
        )
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
      return { name: shortName, ref, commitSha: syntheticCommit, agents }
    }

    const gitSourceRecord: GitSource = {
      type: 'git',
      uri: sourceUri,
      path: resolved.gitPath ?? '',
      ref,
      commit: syntheticCommit,
    }

    const manifestEntry = {
      source: gitSourceRecord,
      agents,
      installedAt: new Date().toISOString(),
      modified: false,
      ...(options.path ? { path: resolve(projectRoot, options.path) } : {}),
      ...(detectedPlatformType === 'AGENT' || detectedPlatformType === 'COMMAND'
        ? { packageType: detectedPlatformType, entryFile: installedPlatformEntryFile }
        : {}),
      ...(depMeta.dependsOn.length > 0 ? { dependsOn: depMeta.dependsOn } : {}),
      ...(depMeta.conflictsWith.length > 0 ? { conflictsWith: depMeta.conflictsWith } : {}),
    }

    const platformSingleFileIntegrity =
      installedPlatformEntryFile &&
      (detectedPlatformType === 'AGENT' || detectedPlatformType === 'COMMAND')
        ? computeSha256FromFiles([
            {
              path: installedPlatformEntryFile,
              content:
                files.find(
                  (f) => (f.path.split('/').pop() ?? f.path) === installedPlatformEntryFile
                )?.content ?? '',
            },
          ])
        : integrity

    const lockfileEntry = {
      source: gitSourceRecord,
      integrity: platformSingleFileIntegrity,
      agents,
    }
    if (options.persist !== false) {
      recordInstalledPackage(projectRoot, scope, shortName, manifestEntry, lockfileEntry)
    }

    const target = options.path ?? agents.join(', ')
    const scopeLabel = scope === 'global' ? 'user' : 'project'

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
        `Installed ${chalk.green(shortName)} ${chalk.dim(`(${scopeLabel})`)} from ${chalk.dim(sourceUri)} ${chalk.cyan(`@${ref}`)} ${chalk.dim(`(${syntheticCommit.slice(0, 7)})`)} to ${target}`
      )
    }

    return {
      name: shortName,
      ref,
      commitSha: syntheticCommit,
      agents,
      manifestEntry,
      lockfileEntry,
    }
  } catch (error) {
    if (error instanceof AgentverError) throw error
    const { code, message } = extractError(error, 'INSTALL_FAILED')
    if (!jsonMode) spinner.fail(`Failed to install: ${message}`)
    throw new AgentverError(code, message)
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
      if (!jsonMode) {
        const spinner = createSpinner('Resolving').start()
        spinner.fail(message)
      }
      throw new AgentverError('VALIDATION_ERROR', message)
    }

    const [namePart, ref] = source.split('@')
    const segments = namePart!.split('/').filter(Boolean)

    if (segments.length < 2) {
      const message = `Invalid package name "${source}" — expected format: org/package-name`
      if (!jsonMode) {
        const spinner = createSpinner('Resolving').start()
        spinner.fail(message)
      }
      throw new AgentverError('VALIDATION_ERROR', message)
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
    let result = await fetchFiles(resolved)

    // If no files found and the source has a specific path, try with skills/ prefix.
    // This handles the common skills.sh community pattern where skills live under a
    // top-level skills/ directory (e.g. skills/seo-audit/SKILL.md instead of seo-audit/SKILL.md).
    if (result.files.length === 0 && gitSource.path) {
      const prefixedResolved: ResolvedRef = {
        ...resolved,
        source: { ...gitSource, path: `skills/${gitSource.path}` },
      }
      const prefixedResult = await fetchFiles(prefixedResolved)
      if (prefixedResult.files.length > 0) {
        result = prefixedResult
      }
    }

    if (result.files.length === 0) {
      const msg = `No files found at ${formatSource(gitSource)}`
      if (!jsonMode) spinner.fail(msg)
      throw new AgentverError('NO_FILES', msg)
    }

    let securityScanResult: SecurityScanResult | undefined

    if (!options.skipAudit) {
      spinner.text = 'Running security scan...'
      const scanResult = await scanFiles(result.files, gitSource, {
        skipAudit: options.skipAudit,
      })
      securityScanResult = scanResult

      if (scanResult.verdict === 'BLOCK') {
        if (!jsonMode) renderScanResult(scanResult, spinner as ReturnType<typeof ora>)
        throw new AgentverError(
          'SECURITY_BLOCK',
          `Security scan blocked installation: ${scanResult.findings.length} finding(s)`
        )
      }

      if (scanResult.verdict === 'WARN') {
        if (jsonMode) {
          // In JSON mode, proceed with warnings (no interactive prompt)
        } else if (options.yes) {
          spinner.start('Continuing installation...')
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
            throw new AgentverError('CANCELLED', 'Installation cancelled by user')
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
    const requestedAgents = toAgentList(options.agent)
    const scope = options.global ? 'global' : 'project'
    const gitUri = `${gitSource.host}/${gitSource.owner}/${gitSource.repo}`
    let agents: string[] = []
    let detectedType: InstalledPackageType | undefined
    let installedEntryFile: string | undefined

    // Enforce dependsOn / conflictsWith before installing
    const depMeta = extractDependencyMetadata(result.files)
    const currentManifestForChecks = readManifest(projectRoot, scope)
    enforceDependencies(depMeta.dependsOn, currentManifestForChecks, shortName)
    enforceConflicts(depMeta.conflictsWith, currentManifestForChecks, shortName)

    if (options.path) {
      await installToCustomPath(shortName, result.files, options, spinner)
      agents = requestedAgents
    } else {
      if (options.detect === false && requestedAgents.length === 0) {
        const msg = 'Use --agent to specify a target agent when --no-detect is enabled'
        if (!jsonMode) spinner.fail(msg)
        throw new AgentverError('VALIDATION_ERROR', msg)
      }

      agents =
        requestedAgents.length > 0
          ? requestedAgents
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

      detectedType = detectPackageType(result.files, options.type)

      if (detectedType === 'BUNDLE') {
        const gitSourceRecord: GitSource = {
          type: 'git',
          uri: gitUri,
          path: gitSource.path,
          ref: gitSource.ref,
          commit: resolved.commitSha,
        }
        return installBundleFlow(shortName, result.files, agents, options, spinner, {
          sourceRecord: gitSourceRecord,
          integrity,
          securityScanResult,
          jsonMode,
          projectRoot,
          scope,
          ref: gitSource.ref,
          commitSha: resolved.commitSha,
        })
      } else if (detectedType === 'AGENT_CONFIG') {
        await installAgentConfig(shortName, result.files, agents, options, spinner)
      } else if (detectedType === 'AGENT' || detectedType === 'COMMAND') {
        installedEntryFile = await installSingleFilePackage(
          shortName,
          result.files,
          agents,
          detectedType,
          options,
          spinner
        )
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

    const manifestEntry = {
      source: gitSourceRecord,
      agents,
      installedAt: new Date().toISOString(),
      modified: false,
      ...(options.path ? { path: resolve(projectRoot, options.path) } : {}),
      ...(detectedType === 'AGENT' || detectedType === 'COMMAND'
        ? { packageType: detectedType, entryFile: installedEntryFile }
        : {}),
      ...(depMeta.dependsOn.length > 0 ? { dependsOn: depMeta.dependsOn } : {}),
      ...(depMeta.conflictsWith.length > 0 ? { conflictsWith: depMeta.conflictsWith } : {}),
    }

    const singleFileIntegrity =
      installedEntryFile && (detectedType === 'AGENT' || detectedType === 'COMMAND')
        ? computeSha256FromFiles([
            {
              path: installedEntryFile,
              content:
                result.files.find((f) => (f.path.split('/').pop() ?? f.path) === installedEntryFile)
                  ?.content ?? '',
            },
          ])
        : integrity

    const lockfileEntry = {
      source: gitSourceRecord,
      integrity: singleFileIntegrity,
      agents,
    }
    if (options.persist !== false) {
      recordInstalledPackage(projectRoot, scope, shortName, manifestEntry, lockfileEntry)
      reportInstallation(shortName, gitSourceRecord, agents, resolved.commitSha)
    }

    const target = options.path ?? agents.join(', ')
    const scopeLabel = scope === 'global' ? 'user' : 'project'
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
        `Installed ${chalk.green(shortName)} ${chalk.dim(`(${scopeLabel})`)} from ${chalk.dim(formatSource(gitSource))} ${chalk.cyan(`@${gitSource.ref}`)} ${chalk.dim(`(${resolved.commitSha.slice(0, 7)})`)} to ${target}`
      )
    }

    return {
      name: shortName,
      ref: gitSource.ref,
      commitSha: resolved.commitSha,
      agents,
      manifestEntry,
      lockfileEntry,
    }
  } catch (error) {
    if (error instanceof AgentverError) throw error
    const { code, message } = extractError(error, 'INSTALL_FAILED')
    if (!jsonMode) spinner.fail(`Failed to install: ${message}`)
    throw new AgentverError(code, message)
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

function detectPackageType(
  files: FetchedFile[],
  typeOverride?: 'agent' | 'command'
): InstalledPackageType {
  if (typeOverride) {
    const normalised = typeOverride.toUpperCase()
    if (normalised === 'AGENT') return 'AGENT'
    if (normalised === 'COMMAND') return 'COMMAND'
  }

  const filenames = new Set(files.map((f) => f.path))

  for (const [type, structure] of Object.entries(PACKAGE_STRUCTURES)) {
    if (type === 'AGENT_CONFIG' || type === 'AGENT' || type === 'COMMAND') continue
    if (filenames.has(structure.entryFile)) return type as InstalledPackageType
  }

  for (const cf of AGENT_CONFIG_FILES) {
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

  const agentConfigSet = new Set<string>(AGENT_CONFIG_FILES)
  const contentFile = files.find((f) => agentConfigSet.has(f.path) || f.path.endsWith('.md'))

  if (!contentFile) {
    spinner.fail('No config content file found in package')
    throw new AgentverError('NO_FILES', 'No config content file found in package')
  }

  const configContent = contentFile.content

  const translations = translateConfig(configContent, name, agents as AgentId[])

  for (const translation of translations) {
    const fullConfigPath = options.global
      ? (getGlobalConfigFilePath(translation.agentId, name)?.replace(/^~/, homedir()) ?? null)
      : resolve(projectRoot, translation.filePath)
    if (!fullConfigPath) continue

    // Guard against path traversal (e.g. malicious package name containing ../)
    // Derive trusted base from a probe with a fixed dummy name, so the base
    // is never influenced by the untrusted package name.
    const probePath = options.global
      ? getGlobalConfigFilePath(translation.agentId, '__probe__')
      : getConfigFilePath(translation.agentId, '__probe__')
    if (!probePath) continue
    const resolvedBase = resolve(
      options.global
        ? dirname(probePath.replace(/^~/, homedir()))
        : join(projectRoot, dirname(probePath))
    )
    const resolvedTarget = resolve(fullConfigPath)
    const relativeToBase = relative(resolvedBase, resolvedTarget)
    if (relativeToBase.startsWith('..') || isAbsolute(relativeToBase)) continue

    const configDir = join(fullConfigPath, '..')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }

    let finalContent = translation.content
    if (existsSync(fullConfigPath)) {
      const existingContent = readFileSync(fullConfigPath, 'utf-8')

      if (isComposedConfig(existingContent)) {
        const existingSections = parseComposedSections(existingContent)
        const alreadyPresent = existingSections.some((s) => s.packageName === name)

        const allConfigs = alreadyPresent
          ? existingSections.map((s, idx) => ({
              packageName: s.packageName,
              content: s.packageName === name ? translation.content : s.content,
              order: idx,
            }))
          : [
              ...existingSections.map((s, idx) => ({
                packageName: s.packageName,
                content: s.content,
                order: idx,
              })),
              {
                packageName: name,
                content: translation.content,
                order: existingSections.length,
              },
            ]
        const composed = composeConfigs(allConfigs)
        finalContent = composed.content
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

async function installSingleFilePackage(
  name: string,
  files: FetchedFile[],
  agents: string[],
  packageType: 'AGENT' | 'COMMAND',
  options: InstallOptions,
  spinner: ReturnType<typeof ora> | SpinnerLike
): Promise<string> {
  const projectRoot = process.cwd()
  const scope = options.global ? 'global' : 'project'

  const mdFiles = files.filter((f) => f.path.endsWith('.md'))
  if (mdFiles.length === 0) {
    spinner.fail('No .md file found in package')
    throw new AgentverError('NO_FILES', 'No .md file found in package')
  }
  if (mdFiles.length > 1) {
    const message = `Expected exactly one markdown file for ${packageType.toLowerCase()} packages, found ${mdFiles.length}`
    spinner.fail(message)
    throw new AgentverError('VALIDATION_ERROR', message)
  }
  const mdFile = mdFiles[0]!

  const fileName = mdFile.path.split('/').pop() ?? mdFile.path

  if (options.dryRun) {
    const typeLabel = packageType === 'AGENT' ? 'agent' : 'command'
    spinner.info(
      `${chalk.yellow('[dry-run]')} Would install ${typeLabel} ${chalk.green(name)} (${fileName}) to ${agents.join(', ')}`
    )
    return fileName
  }

  spinner.text = `Installing ${packageType.toLowerCase()} ${name} to ${agents.length} agent(s)...`

  const getPlacementPath = packageType === 'AGENT' ? getAgentPlacementPath : getCommandPlacementPath
  const writtenAgents: string[] = []

  for (const agentId of agents) {
    const placementPath = getPlacementPath(agentId as AgentId, fileName, scope)
    if (!placementPath) {
      const typeLabel = packageType === 'AGENT' ? 'agent' : 'command'
      spinner.text = `${agentId} does not support ${typeLabel}-type packages. Skipping.`
      continue
    }

    const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
    if (!fullPath) continue

    const parentDir = dirname(fullPath)
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }

    writeFileSync(fullPath, mdFile.content, 'utf-8')
    writtenAgents.push(agentId)
  }

  if (writtenAgents.length === 0) {
    const typeLabel = packageType === 'AGENT' ? 'agent' : 'command'
    const message = `No agents support ${typeLabel}-type packages`
    spinner.fail(message)
    throw new AgentverError('VALIDATION_ERROR', message)
  }

  return fileName
}

type BundleFlowContext = {
  sourceRecord: PackageSource
  integrity: string
  securityScanResult?: SecurityScanResult
  jsonMode: boolean
  projectRoot: string
  scope: 'project' | 'global'
  ref: string
  commitSha: string
}

/**
 * Shared bundle install flow used by both platform and git install paths.
 *
 * Delegates to `installBundleFromFiles` for actual package expansion,
 * then records the bundle itself in the manifest/lockfile.
 */
async function installBundleFlow(
  bundleName: string,
  files: FetchedFile[],
  agents: string[],
  options: InstallOptions,
  spinner: ReturnType<typeof ora> | SpinnerLike,
  ctx: BundleFlowContext
): Promise<InstallResult> {
  const {
    sourceRecord,
    integrity,
    securityScanResult,
    jsonMode,
    projectRoot,
    scope,
    ref,
    commitSha,
  } = ctx
  const bundleResult = await installBundleFromFiles(
    bundleName,
    files,
    agents,
    options,
    spinner,
    sourceRecord,
    installPackage
  )

  if (!options.dryRun) {
    recordInstalledPackage(
      projectRoot,
      scope,
      bundleName,
      {
        source: sourceRecord,
        agents,
        installedAt: new Date().toISOString(),
        modified: false,
        packageType: 'BUNDLE',
      },
      {
        source: sourceRecord,
        integrity,
        agents,
      }
    )
  }

  const scopeLabel = scope === 'global' ? 'user' : 'project'
  const warnings: string[] = []
  if (securityScanResult?.verdict === 'WARN') {
    warnings.push(`Security scan passed with ${securityScanResult.findings.length} warning(s)`)
  }

  if (jsonMode) {
    outputSuccess<BundleInstallResult>(bundleResult, warnings.length > 0 ? warnings : undefined)
  } else {
    const installedCount = bundleResult.installed.length
    const skippedCount = bundleResult.skipped.length
    let summary = `Installed bundle ${chalk.green(bundleName)} ${chalk.dim(`(${scopeLabel})`)} — ${installedCount} package(s)`
    if (skippedCount > 0) {
      summary += `, ${skippedCount} skipped`
    }
    spinner.succeed(summary)
  }

  return { name: bundleName, ref, commitSha, agents }
}

export function registerInstallCommand(program: Command): void {
  program
    .command('install <source>')
    .description('Install a skill from a Git repository or well-known domain')
    .option('--agent <agent>', 'Target specific agent', (value: string, previous?: string[]) => [
      ...(previous ?? []),
      value,
    ])
    .option('-y, --yes', 'Accept warning prompts non-interactively')
    .option('--global', 'Install at user level (~/.agents/skills/) — available across all projects')
    .option('--dry-run', 'Show what would be installed without making changes')
    .option('--path <path>', 'Override placement path (relative to cwd or absolute)')
    .option('--no-detect', 'Skip agent auto-detection (requires --agent)')
    .option('--skip-audit', 'Skip the security scan')
    .option('--type <type>', 'Package type override (agent, command)')
    .addHelpText(
      'after',
      `
Source formats:
  github.com/owner/repo              Git repository (latest default branch)
  github.com/owner/repo/path@ref     Subdirectory at specific ref
  github.com/owner/repo#sha          Pinned to exact commit
  gitlab.com/owner/repo              GitLab repositories
  example.com/my-skill               Well-known domain (RFC-style discovery)
  agentver://org/skills/name@ref     Platform-hosted skill
  org/bundle-name                    Bundle (auto-detected from agentver.bundle.yaml)`
    )
    .action(async (source: string, options: InstallOptions) => {
      try {
        await installPackage(source, options)
      } catch (error) {
        const jsonMode = isJSONMode()
        const { code, message } = extractError(error, 'INSTALL_FAILED')
        if (jsonMode) {
          outputError(code, message)
        } else if (code !== 'CANCELLED') {
          // spinner.fail() is called before throwing in all install paths,
          // but write to stderr as a safety net for any path that misses it
          process.stderr.write(`${message}\n`)
        }
        process.exit(code === 'CANCELLED' ? 0 : 1)
      }
    })
}
