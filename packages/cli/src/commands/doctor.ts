import { execSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
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
import { resolvePlacementPath, type Scope } from '../utils/paths.js'

type CheckStatus = DoctorCheck['status']

const MANIFEST_DIR = '.agentver'
const MANIFEST_FILE = 'manifest.json'
const LOCKFILE_FILE = 'lockfile.json'
const NETWORK_TIMEOUT_MS = 3000
const MIN_NODE_VERSION = 20

function scopeLabel(scope: Scope): string {
  return scope === 'global' ? ' (global)' : ' (project)'
}

function check(name: string, status: CheckStatus, message: string): DoctorCheck {
  return { name, status, message }
}

function checkManifestIntegrity(projectRoot: string, scope: Scope): DoctorCheck {
  const suffix = scope === 'global' ? '-global' : ''
  const name = `manifest-integrity${suffix}`
  const label = scopeLabel(scope)
  const manifestRoot =
    scope === 'global' ? join(homedir(), MANIFEST_DIR) : join(projectRoot, MANIFEST_DIR)
  const manifestPath = join(manifestRoot, MANIFEST_FILE)

  if (!existsSync(manifestPath)) {
    return check(name, 'warn', `Manifest file not found (no skills installed yet)${label}`)
  }

  let raw: string
  try {
    raw = readFileSync(manifestPath, 'utf-8')
  } catch {
    return check(name, 'fail', `Cannot read manifest file${label}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return check(name, 'fail', `Manifest contains invalid JSON${label}`)
  }

  const result = manifestAnySchema.safeParse(parsed)
  if (!result.success) {
    return check(name, 'fail', `Manifest does not match expected schema${label}`)
  }

  return check(name, 'pass', `Manifest is valid${label}`)
}

function checkLockfileIntegrity(projectRoot: string, scope: Scope): DoctorCheck {
  const suffix = scope === 'global' ? '-global' : ''
  const name = `lockfile-integrity${suffix}`
  const label = scopeLabel(scope)
  const lockfileRoot =
    scope === 'global' ? join(homedir(), MANIFEST_DIR) : join(projectRoot, MANIFEST_DIR)
  const lockfilePath = join(lockfileRoot, LOCKFILE_FILE)

  if (!existsSync(lockfilePath)) {
    return check(name, 'warn', `Lockfile not found (no skills installed yet)${label}`)
  }

  let raw: string
  try {
    raw = readFileSync(lockfilePath, 'utf-8')
  } catch {
    return check(name, 'fail', `Cannot read lockfile${label}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return check(name, 'fail', `Lockfile contains invalid JSON${label}`)
  }

  const result = lockfileAnySchema.safeParse(parsed)
  if (!result.success) {
    return check(name, 'fail', `Lockfile does not match expected schema${label}`)
  }

  return check(name, 'pass', `Lockfile is valid${label}`)
}

function checkManifestLockfileSync(projectRoot: string, scope: Scope): DoctorCheck {
  const suffix = scope === 'global' ? '-global' : ''
  const checkName = `manifest-lockfile-sync${suffix}`
  const label = scopeLabel(scope)

  const manifest = readManifest(projectRoot, scope)
  const lockfile = readLockfile(projectRoot, scope)

  const manifestNames = new Set(Object.keys(manifest.packages))
  const lockfileNames = new Set(Object.keys(lockfile.packages))

  if (manifestNames.size === 0 && lockfileNames.size === 0) {
    return check(checkName, 'pass', `Manifest and lockfile are in sync (both empty)${label}`)
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
    return check(checkName, 'fail', `Out of sync — ${parts.join('; ')}${label}`)
  }

  return check(checkName, 'pass', `Manifest and lockfile are in sync${label}`)
}

function checkSkillFilesExist(projectRoot: string, scope: Scope): DoctorCheck {
  const suffix = scope === 'global' ? '-global' : ''
  const checkName = `skill-files-exist${suffix}`
  const label = scopeLabel(scope)

  const manifest = readManifest(projectRoot, scope)
  const entries = Object.keys(manifest.packages)

  if (entries.length === 0) {
    return check(checkName, 'pass', `No packages installed${label}`)
  }

  const missing: string[] = []

  for (const name of entries) {
    const canonicalPath = getCanonicalSkillPath(projectRoot, name, scope)
    if (!existsSync(canonicalPath) || !lstatSync(canonicalPath).isDirectory()) {
      missing.push(name)
    }
  }

  if (missing.length > 0) {
    return check(checkName, 'fail', `Missing skill directories: ${missing.join(', ')}${label}`)
  }

  return check(checkName, 'pass', `All ${entries.length} skill directories present${label}`)
}

function checkSymlinksValid(projectRoot: string, scope: Scope): DoctorCheck {
  const suffix = scope === 'global' ? '-global' : ''
  const checkName = `symlinks-valid${suffix}`
  const label = scopeLabel(scope)

  const manifest = readManifest(projectRoot, scope)
  const entries = Object.entries(manifest.packages)

  if (entries.length === 0) {
    return check(checkName, 'pass', `No packages installed${label}`)
  }

  const broken: string[] = []

  for (const [name, pkg] of entries) {
    for (const agentId of pkg.agents) {
      const placementPath = getSkillPlacementPath(agentId as AgentId, name, scope)
      if (!placementPath) continue

      const agentSkillPath = resolvePlacementPath(placementPath, projectRoot, scope)
      if (!agentSkillPath) {
        broken.push(`${name}/${agentId} (invalid placement path)`)
        continue
      }

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
    return check(checkName, 'fail', `Invalid symlinks: ${broken.join(', ')}${label}`)
  }

  const totalLinks = entries.reduce((sum, [, pkg]) => sum + pkg.agents.length, 0)
  return check(checkName, 'pass', `All ${totalLinks} symlinks valid${label}`)
}

async function checkAuthentication(): Promise<DoctorCheck> {
  const creds = await getCredentials()
  const hasCredentials = !!(creds?.token ?? creds?.apiKey)

  if (!hasCredentials) {
    return check('authentication', 'warn', 'No credentials configured (run agentver login)')
  }

  if (!creds) {
    return check('authentication', 'warn', 'No credentials configured (run agentver login)')
  }

  const platformUrl = getPlatformUrl()
  if (!platformUrl) {
    return check('authentication', 'warn', 'Credentials present but no platform URL configured')
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)

    const headers: Record<string, string> = {}
    if (creds.token) {
      headers.Authorization = `Bearer ${creds.token}`
    } else if (creds.apiKey) {
      headers['X-API-Key'] = creds.apiKey
    }

    const response = await fetch(`${platformUrl}/api/v1/me`, {
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.ok) {
      return check('authentication', 'pass', 'Authenticated and platform reachable')
    }

    if (response.status === 401) {
      return check(
        'authentication',
        'fail',
        'Authentication expired or invalid (run agentver login again)'
      )
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

      const scopes: Scope[] = ['project', 'global']
      for (const scope of scopes) {
        checks.push(checkManifestIntegrity(projectRoot, scope))
        checks.push(checkLockfileIntegrity(projectRoot, scope))
        checks.push(checkManifestLockfileSync(projectRoot, scope))
        checks.push(checkSkillFilesExist(projectRoot, scope))
        checks.push(checkSymlinksValid(projectRoot, scope))
      }
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
