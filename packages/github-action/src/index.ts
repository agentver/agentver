import { resolve } from 'node:path'
import * as core from '@actions/core'
import type { Lockfile, Manifest } from '@agentver/shared'
import {
  installAllPackages,
  ManifestNotFoundError,
  RegistryAuthError,
  readLockfileFile,
  readManifestFile,
  updateLockfile,
  writeLockfileFile,
} from './installer'
import { buildSummary, generateJobSummary, setOutputs } from './reporter'

async function run(): Promise<void> {
  try {
    const apiKey = core.getInput('api-key', { required: true })
    core.setSecret(apiKey)
    const registryUrl = core.getInput('registry-url')
    const manifestPath = core.getInput('manifest-path')
    const lockfilePath = core.getInput('lockfile-path')
    const agentsInput = core.getInput('agents')
    const workingDirectory = core.getInput('working-directory')
    const verifyIntegrity = core.getBooleanInput('verify-integrity')

    const resolvedWorkDir = resolve(workingDirectory)
    const resolvedManifestPath = resolve(resolvedWorkDir, manifestPath)
    const resolvedLockfilePath = resolve(resolvedWorkDir, lockfilePath)

    const agents = agentsInput
      ? agentsInput
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean)
      : []

    core.info(`Working directory: ${resolvedWorkDir}`)
    core.info(`Manifest path: ${resolvedManifestPath}`)
    core.info(`Registry URL: ${registryUrl}`)
    core.info(`Integrity verification: ${verifyIntegrity ? 'enabled' : 'disabled'}`)

    if (agents.length > 0) {
      core.info(`Target agents: ${agents.join(', ')}`)
    } else {
      core.info('Target agents: auto-detect')
    }

    // Read manifest
    let manifest: Manifest
    try {
      manifest = readManifestFile(resolvedManifestPath)
    } catch (error) {
      if (error instanceof ManifestNotFoundError) {
        core.warning(error.message)
        core.info('No manifest found — nothing to install.')
        core.setOutput('installed-count', '0')
        core.setOutput('installed-skills', '[]')
        core.setOutput('agents-configured', '')
        return
      }
      throw error
    }

    const packageCount = Object.keys(manifest.packages).length
    if (packageCount === 0) {
      core.info('Manifest contains no packages — nothing to install.')
      core.setOutput('installed-count', '0')
      core.setOutput('installed-skills', '[]')
      core.setOutput('agents-configured', '')
      return
    }

    core.info(`Found ${packageCount} package(s) in manifest.`)

    // Read existing lockfile
    const existingLockfile: Lockfile = readLockfileFile(resolvedLockfilePath) ?? {
      version: 1,
      packages: {},
    }

    // Install all packages
    const { results, resolvedData } = await installAllPackages(
      manifest,
      {
        registryUrl,
        apiKey,
        workingDirectory: resolvedWorkDir,
        verifyIntegrity,
        agents,
      },
      existingLockfile
    )

    // Update lockfile
    const updatedLockfile = updateLockfile(existingLockfile, results, resolvedData, registryUrl)
    writeLockfileFile(resolvedLockfilePath, updatedLockfile)
    core.info(`Lockfile updated at ${resolvedLockfilePath}`)

    // Build summary and set outputs
    const summary = buildSummary(results)
    setOutputs(summary)
    await generateJobSummary(summary)

    // Fail the action if any packages failed
    if (summary.totalFailed > 0 && summary.totalInstalled === 0) {
      core.setFailed(
        `All ${summary.totalFailed} package(s) failed to install. Check the logs above for details.`
      )
    } else if (summary.totalFailed > 0) {
      core.warning(`${summary.totalFailed} of ${results.length} package(s) failed to install.`)
    }

    core.info(`Done. ${summary.totalInstalled} skill(s) installed successfully.`)
  } catch (error) {
    if (error instanceof RegistryAuthError) {
      core.setFailed(error.message)
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    core.setFailed(`Unexpected error: ${message}`)
  }
}

run()
