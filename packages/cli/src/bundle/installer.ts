import {
  AgentverError,
  type BundleInstallResult,
  type BundleManifest,
  bundleManifestSchema,
  PACKAGE_STRUCTURES,
  type PackageSource,
} from '@agentver/shared'
import chalk from 'chalk'
import { parse as parseYaml } from 'yaml'
import type { InstallOptions, InstallResult } from '../commands/install.js'
import type { FetchedFile } from '../git/types.js'
import type { SpinnerLike } from '../output.js'
import { computeSha256FromFiles } from '../storage/integrity'
import { updateManifestAndLockfile } from '../storage/pair'
import type { ResolvedPackageRef } from './resolver.js'
import { resolveBundle, validateBundleManifest } from './resolver.js'

// The package type directories within a bundle
const TYPE_DIRECTORY_MAP: Record<ResolvedPackageRef['type'], string> = {
  skill: 'skills',
  prompt: 'prompts',
  rule: 'rules',
  plugin: 'plugins',
  script: 'scripts',
}

// Map from resolver type to the package type enum value stored in the manifest
const TYPE_PACKAGE_TYPE_MAP: Record<
  ResolvedPackageRef['type'],
  'SKILL' | 'PROMPT' | 'PLUGIN' | 'SCRIPT'
> = {
  skill: 'SKILL',
  prompt: 'PROMPT',
  rule: 'SKILL', // rules use SKILL structure
  plugin: 'PLUGIN',
  script: 'SCRIPT',
}

type BundleInstalledPackage = {
  name: string
  type: string
  source: { type: string; uri?: string }
}

type BundleSkippedPackage = {
  name: string
  type: string
  reason: string
}

/**
 * Extract local files for a constituent package from the bundle's fetched files.
 *
 * Looks in `<typeDir>/<name>/` within the bundle files. Returns files with
 * paths relative to the package root (stripped of the `<typeDir>/<name>/` prefix).
 */
function extractLocalPackageFiles(
  allFiles: FetchedFile[],
  packageName: string,
  packageType: ResolvedPackageRef['type']
): FetchedFile[] {
  const typeDir = TYPE_DIRECTORY_MAP[packageType]
  const prefix = `${typeDir}/${packageName}/`

  const localFiles: FetchedFile[] = []
  for (const file of allFiles) {
    if (file.path.startsWith(prefix)) {
      localFiles.push({
        path: file.path.slice(prefix.length),
        content: file.content,
        size: file.size,
      })
    }
  }

  return localFiles
}

/**
 * Check if a set of files has the required entry file for the given package type.
 */
function hasEntryFile(files: FetchedFile[], packageType: ResolvedPackageRef['type']): boolean {
  const structureKey = TYPE_PACKAGE_TYPE_MAP[packageType]
  const structure = PACKAGE_STRUCTURES[structureKey]
  if (!structure) return files.length > 0

  return files.some((f) => f.path === structure.entryFile)
}

/**
 * Install a bundle from its fetched files.
 *
 * Parses `agentver.bundle.yaml`, resolves the bundle manifest, and installs
 * each constituent package. Packages found locally in the bundle files are
 * installed directly; others are delegated to `installPackage` for platform
 * or git resolution.
 */
export async function installBundleFromFiles(
  bundleName: string,
  files: FetchedFile[],
  agents: string[],
  options: InstallOptions,
  spinner: SpinnerLike,
  source: PackageSource,
  installPackageFn: (source: string, options: InstallOptions) => Promise<InstallResult>
): Promise<BundleInstallResult> {
  const bundleFile = files.find((f) => f.path === 'agentver.bundle.yaml')
  if (!bundleFile) {
    throw new AgentverError('VALIDATION_ERROR', 'Bundle is missing agentver.bundle.yaml')
  }

  // Parse YAML
  let rawManifest: unknown
  try {
    rawManifest = parseYaml(bundleFile.content)
  } catch (err) {
    throw new AgentverError(
      'VALIDATION_ERROR',
      `Failed to parse agentver.bundle.yaml: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  // Validate against schema
  const parseResult = bundleManifestSchema.safeParse(rawManifest)
  if (!parseResult.success) {
    const issues = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new AgentverError(
      'VALIDATION_ERROR',
      `Invalid agentver.bundle.yaml:\n  ${issues.join('\n  ')}`
    )
  }

  const manifest: BundleManifest = parseResult.data

  // Validate manifest for structural issues
  const validationErrors = validateBundleManifest(manifest)
  if (validationErrors.length > 0) {
    throw new AgentverError(
      'VALIDATION_ERROR',
      `Bundle manifest validation failed:\n  ${validationErrors.join('\n  ')}`
    )
  }

  // Resolve into flat package list
  const resolved = resolveBundle(manifest)

  spinner.text = `Installing bundle "${manifest.name}" v${manifest.version} (${resolved.packages.length} package(s))...`

  const installed: BundleInstalledPackage[] = []
  const skipped: BundleSkippedPackage[] = []
  const projectRoot = process.cwd()
  const scope = options.global ? 'global' : 'project'

  // Install each constituent package
  for (const pkgRef of resolved.packages) {
    const localFiles = extractLocalPackageFiles(files, pkgRef.name, pkgRef.type)

    if (localFiles.length > 0 && hasEntryFile(localFiles, pkgRef.type)) {
      // Install from local bundle files
      spinner.text = `Installing ${pkgRef.type} "${pkgRef.name}" from bundle...`

      try {
        if (!options.dryRun) {
          const { installLocalBundleConstituent } = await import('./local-install.js')
          await installLocalBundleConstituent(pkgRef.name, localFiles, agents, options, spinner)

          const integrity = computeSha256FromFiles(localFiles)
          updateManifestAndLockfile(projectRoot, scope, (manifest, lockfile) => {
            manifest.packages[pkgRef.name] = {
              source,
              agents,
              installedAt: new Date().toISOString(),
              modified: false,
              bundle: bundleName,
              packageType: TYPE_PACKAGE_TYPE_MAP[pkgRef.type],
            }
            lockfile.packages[pkgRef.name] = {
              source,
              integrity,
              agents,
            }
            return { manifest, lockfile }
          })
        }

        installed.push({
          name: pkgRef.name,
          type: pkgRef.type,
          source: { type: 'local' },
        })
      } catch (err) {
        if (pkgRef.optional) {
          skipped.push({
            name: pkgRef.name,
            type: pkgRef.type,
            reason: `Optional package failed: ${err instanceof Error ? err.message : String(err)}`,
          })
        } else {
          throw err
        }
      }
    } else {
      // Resolve via platform/git
      spinner.text = `Resolving ${pkgRef.type} "${pkgRef.name}" from platform...`

      const packageSource = pkgRef.version ? `${pkgRef.name}@${pkgRef.version}` : pkgRef.name

      try {
        const result = await installPackageFn(packageSource, {
          ...options,
          // Skip audit for individual constituents — the bundle itself was audited
          skipAudit: true,
        })

        if (!options.dryRun) {
          updateManifestAndLockfile(projectRoot, scope, (manifest, lockfile) => {
            const entry = manifest.packages[result.name]
            if (entry) {
              entry.bundle = bundleName
              entry.packageType = TYPE_PACKAGE_TYPE_MAP[pkgRef.type]
            }
            return { manifest, lockfile }
          })
        }

        installed.push({
          name: result.name,
          type: pkgRef.type,
          source: { type: 'git', uri: packageSource },
        })
      } catch (err) {
        if (pkgRef.optional) {
          skipped.push({
            name: pkgRef.name,
            type: pkgRef.type,
            reason: `Optional package failed: ${err instanceof Error ? err.message : String(err)}`,
          })
        } else {
          throw err
        }
      }
    }
  }

  // Log MCP server info (configuration deferred to a future phase)
  const mcpServerStatus = resolved.mcpServers.map((server) => ({
    name: server.name,
    configured: false,
  }))

  if (resolved.mcpServers.length > 0) {
    spinner.text = 'MCP server configuration...'
    console.log(
      chalk.yellow(
        `\n  Bundle includes ${resolved.mcpServers.length} MCP server(s) that require manual configuration:`
      )
    )
    for (const server of resolved.mcpServers) {
      console.log(
        `    ${chalk.dim('•')} ${chalk.bold(server.name)}${server.description ? ` — ${server.description}` : ''}`
      )
      if (server.command) {
        console.log(
          `      ${chalk.dim('command:')} ${server.command} ${(server.args ?? []).join(' ')}`
        )
      }
      if (server.url) {
        console.log(`      ${chalk.dim('url:')} ${server.url}`)
      }
    }
    console.log()
  }

  // Log missing credentials
  if (resolved.credentials.size > 0) {
    const requiredCreds = [...resolved.credentials.values()].filter((c) => c.required)
    if (requiredCreds.length > 0) {
      console.log(chalk.yellow(`  Bundle requires ${requiredCreds.length} credential(s):`))
      for (const cred of requiredCreds) {
        console.log(`    ${chalk.dim('•')} ${chalk.bold(cred.key)} — ${cred.description}`)
      }
      console.log()
    }
  }

  return {
    bundleName: manifest.name,
    bundleVersion: manifest.version,
    installed,
    skipped,
    mcpServers: mcpServerStatus,
  }
}
