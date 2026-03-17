import { execSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import {
  type DoctorCheck,
  type DoctorResult,
  lockfileAnySchema,
  manifestAnySchema,
} from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputSuccess } from '../output'
import { getCredentials } from '../registry/auth.js'
import { getPlatformUrl } from '../registry/config.js'
import { getCanonicalSkillPath } from '../storage/canonical.js'
import { readLockfile } from '../storage/lockfile.js'
import { readManifest } from '../storage/manifest.js'

type CheckStatus = DoctorCheck['status']

const MANIFEST_DIR = '.agentver'
const MANIFEST_FILE = 'manifest.json'
const LOCKFILE_FILE = 'lockfile.json'
const NETWORK_TIMEOUT_MS = 3000
const MIN_NODE_VERSION = 20

function check(name: string, status: CheckStatus, message: string): DoctorCheck {
  return { name, status, message }
}

function checkManifestIntegrity(projectRoot: string): DoctorCheck {
  const manifestPath = join(projectRoot, MANIFEST_DIR, MANIFEST_FILE)

  if (!existsSync(manifestPath)) {
    return check('manifest-integrity', 'warn', 'Manifest file not found (no skills installed yet)')
  }

  let raw: string
  try {
    raw = readFileSync(manifestPath, 'utf-8')
  } catch {
    return check('manifest-integrity', 'fail', 'Cannot read manifest file')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return check('manifest-integrity', 'fail', 'Manifest contains invalid JSON')
  }

  const result = manifestAnySchema.safeParse(parsed)
  if (!result.success) {
    return check('manifest-integrity', 'fail', 'Manifest does not match expected schema')
  }

  return check('manifest-integrity', 'pass', 'Manifest is valid')
}

function checkLockfileIntegrity(projectRoot: string): DoctorCheck {
  const lockfilePath = join(projectRoot, MANIFEST_DIR, LOCKFILE_FILE)

  if (!existsSync(lockfilePath)) {
    return check('lockfile-integrity', 'warn', 'Lockfile not found (no skills installed yet)')
  }

  let raw: string
  try {
    raw = readFileSync(lockfilePath, 'utf-8')
  } catch {
    return check('lockfile-integrity', 'fail', 'Cannot read lockfile')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return check('lockfile-integrity', 'fail', 'Lockfile contains invalid JSON')
  }

  const result = lockfileAnySchema.safeParse(parsed)
  if (!result.success) {
    return check('lockfile-integrity', 'fail', 'Lockfile does not match expected schema')
  }

  return check('lockfile-integrity', 'pass', 'Lockfile is valid')
}

function checkManifestLockfileSync(projectRoot: string): DoctorCheck {
  const manifest = readManifest(projectRoot)
  const lockfile = readLockfile(projectRoot)

  const manifestNames = new Set(Object.keys(manifest.packages))
  const lockfileNames = new Set(Object.keys(lockfile.packages))

  if (manifestNames.size === 0 && lockfileNames.size === 0) {
    return check('manifest-lockfile-sync', 'pass', 'Manifest and lockfile are in sync (both empty)')
  }

  const inManifestOnly: string[] = []
  const inLockfileOnly: string[] = []

  for (const name of manifestNames) {
    if (!lockfileNames.has(name)) {
      inManifestOnly.push(name)
    }
  }

  for (const name of lockfileNames) {
    if (!manifestNames.has(name)) {
      inLockfileOnly.push(name)
    }
  }

  if (inManifestOnly.length > 0 || inLockfileOnly.length > 0) {
    const parts: string[] = []
    if (inManifestOnly.length > 0) {
      parts.push(`in manifest but not lockfile: ${inManifestOnly.join(', ')}`)
    }
    if (inLockfileOnly.length > 0) {
      parts.push(`in lockfile but not manifest: ${inLockfileOnly.join(', ')}`)
    }
    return check('manifest-lockfile-sync', 'fail', `Out of sync — ${parts.join('; ')}`)
  }

  return check('manifest-lockfile-sync', 'pass', 'Manifest and lockfile are in sync')
}

function checkSkillFilesExist(projectRoot: string): DoctorCheck {
  const manifest = readManifest(projectRoot)
  const entries = Object.keys(manifest.packages)

  if (entries.length === 0) {
    return check('skill-files-exist', 'pass', 'No packages installed')
  }

  const missing: string[] = []

  for (const name of entries) {
    const canonicalPath = getCanonicalSkillPath(projectRoot, name, 'project')
    if (!existsSync(canonicalPath) || !lstatSync(canonicalPath).isDirectory()) {
      missing.push(name)
    }
  }

  if (missing.length > 0) {
    return check('skill-files-exist', 'fail', `Missing skill directories: ${missing.join(', ')}`)
  }

  return check('skill-files-exist', 'pass', `All ${entries.length} skill directories present`)
}

function checkSymlinksValid(projectRoot: string): DoctorCheck {
  const manifest = readManifest(projectRoot)
  const entries = Object.entries(manifest.packages)

  if (entries.length === 0) {
    return check('symlinks-valid', 'pass', 'No packages installed')
  }

  const broken: string[] = []

  for (const [name, pkg] of entries) {
    for (const agentId of pkg.agents) {
      const placementPath = getSkillPlacementPath(agentId as AgentId, name, 'project')
      if (!placementPath) continue

      const agentSkillPath = join(projectRoot, placementPath)

      if (!existsSync(agentSkillPath)) {
        broken.push(`${name}/${agentId}`)
        continue
      }

      try {
        const stats = lstatSync(agentSkillPath)
        if (stats.isSymbolicLink()) {
          const target = readlinkSync(agentSkillPath)
          const resolvedTarget = join(dirname(agentSkillPath), target)
          if (!existsSync(resolvedTarget)) {
            broken.push(`${name}/${agentId} (broken symlink)`)
          }
        }
      } catch {
        broken.push(`${name}/${agentId} (unreadable)`)
      }
    }
  }

  if (broken.length > 0) {
    return check('symlinks-valid', 'fail', `Invalid symlinks: ${broken.join(', ')}`)
  }

  const totalLinks = entries.reduce((sum, [, pkg]) => sum + pkg.agents.length, 0)
  return check('symlinks-valid', 'pass', `All ${totalLinks} symlinks valid`)
}

async function checkAuthentication(): Promise<DoctorCheck> {
  const creds = await getCredentials()
  const hasCredentials = !!(creds?.token ?? creds?.apiKey)

  if (!hasCredentials) {
    return check('authentication', 'warn', 'No credentials configured (run agentver login)')
  }

  const platformUrl = getPlatformUrl()
  if (!platformUrl) {
    return check('authentication', 'warn', 'Credentials present but no platform URL configured')
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)

    const response = await fetch(`${platformUrl}/health`, {
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.ok) {
      return check('authentication', 'pass', 'Authenticated and platform reachable')
    }

    return check(
      'authentication',
      'warn',
      `Platform returned status ${String(response.status)} (offline mode available)`
    )
  } catch {
    return check('authentication', 'warn', 'Platform unreachable (offline mode available)')
  }
}

function checkGitAvailable(): DoctorCheck {
  try {
    execSync('git --version', { stdio: 'pipe' })
    return check('git-available', 'pass', 'Git is available')
  } catch {
    return check('git-available', 'fail', 'Git is not installed or not on PATH')
  }
}

function checkNodeVersion(): DoctorCheck {
  const major = parseInt(process.versions.node.split('.')[0] ?? '0', 10)

  if (major >= MIN_NODE_VERSION) {
    return check(
      'node-version',
      'pass',
      `Node ${process.versions.node} (>= ${String(MIN_NODE_VERSION)})`
    )
  }

  return check(
    'node-version',
    'fail',
    `Node ${process.versions.node} is below minimum ${String(MIN_NODE_VERSION)}`
  )
}

function formatCheck(result: DoctorCheck): string {
  switch (result.status) {
    case 'pass':
      return `  ${chalk.green('✓')} ${result.message}`
    case 'fail':
      return `  ${chalk.red('✗')} ${result.message}`
    case 'warn':
      return `  ${chalk.yellow('⚠')} ${result.message}`
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run health checks to diagnose common issues')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const jsonMode = isJSONMode() || options.json === true
      const projectRoot = process.cwd()

      const checks: DoctorCheck[] = []

      checks.push(checkManifestIntegrity(projectRoot))
      checks.push(checkLockfileIntegrity(projectRoot))
      checks.push(checkManifestLockfileSync(projectRoot))
      checks.push(checkSkillFilesExist(projectRoot))
      checks.push(checkSymlinksValid(projectRoot))
      checks.push(await checkAuthentication())
      checks.push(checkGitAvailable())
      checks.push(checkNodeVersion())

      const passed = checks.filter((c) => c.status === 'pass').length
      const failed = checks.filter((c) => c.status === 'fail').length
      const warnings = checks.filter((c) => c.status === 'warn').length

      if (jsonMode) {
        const result: DoctorResult = { checks, passed, failed, warnings }
        outputSuccess(result)
        process.exit(failed > 0 ? 1 : 0)
        return
      }

      console.log(chalk.bold('\nHealth checks:\n'))

      for (const result of checks) {
        console.log(formatCheck(result))
      }

      console.log()
      console.log(
        chalk.dim(
          `${chalk.green(String(passed))} passed, ${chalk.red(String(failed))} failed, ${chalk.yellow(String(warnings))} warnings`
        )
      )
      console.log()

      process.exit(failed > 0 ? 1 : 0)
    })
}
