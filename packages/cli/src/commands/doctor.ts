import { execSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { type AgentId, getSkillPlacementPath } from '@agentver/agent-definitions'
import {
  type DoctorCheck,
  type DoctorResult,
  lockfileV2Schema,
  manifestV2Schema,
  STORAGE_SCHEMA_VERSION,
} from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputSuccess } from '../output'
import { getCredentials } from '../registry/auth.js'
import { getPlatformUrl } from '../registry/config.js'
import { getCanonicalSkillPath } from '../storage/canonical.js'
import { readLockfile } from '../storage/lockfile.js'
import { readManifest } from '../storage/manifest.js'
import { getPackageDisplayName } from '../storage/package-identity.js'
import { resolvePlacementPath, type Scope } from '../utils/paths.js'

type CheckStatus = DoctorCheck['status']

type FixableDoctorCheck = DoctorCheck & {
  fix?: () => string | null
}

const MANIFEST_DIR = '.agentver'
const MANIFEST_FILE = 'manifest.json'
const LOCKFILE_FILE = 'lockfile.json'
const NETWORK_TIMEOUT_MS = 3000
const MIN_NODE_VERSION = 20

function scopeLabel(scope: Scope): string {
  return scope === 'global' ? ' (global)' : ' (project)'
}

function check(
  name: string,
  status: CheckStatus,
  message: string,
  fix?: () => string | null
): FixableDoctorCheck {
  return { name, status, message, fix }
}

function writeEmptyManifest(manifestRoot: string): void {
  mkdirSync(manifestRoot, { recursive: true })
  writeFileSync(
    join(manifestRoot, MANIFEST_FILE),
    JSON.stringify({ version: STORAGE_SCHEMA_VERSION, packages: {} }, null, 2) + '\n'
  )
}

function writeEmptyLockfile(lockfileRoot: string): void {
  mkdirSync(lockfileRoot, { recursive: true })
  writeFileSync(
    join(lockfileRoot, LOCKFILE_FILE),
    JSON.stringify({ version: STORAGE_SCHEMA_VERSION, packages: {} }, null, 2) + '\n'
  )
}

/**
 * Attempt to repair a manifest/lockfile that fails schema validation.
 * Fixes known issues like empty commit fields, missing version, etc.
 */
function repairStorageFile(
  filePath: string,
  schema: typeof manifestV2Schema | typeof lockfileV2Schema
): string | null {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null // Can't fix invalid JSON
  }

  // Ensure version field
  if (!parsed.version) {
    parsed.version = STORAGE_SCHEMA_VERSION
  }

  // Ensure packages is an object
  if (!parsed.packages || typeof parsed.packages !== 'object') {
    parsed.packages = {}
  }

  // Fix each package entry
  const packages = parsed.packages as Record<string, Record<string, unknown>>
  for (const [key, pkg] of Object.entries(packages)) {
    if (!pkg || typeof pkg !== 'object') continue

    const source = pkg.source as Record<string, unknown> | undefined
    if (source && typeof source === 'object') {
      // Fix empty commit fields (must be >= 7 chars or absent)
      if (source.type === 'git' || source.type === 'platform') {
        if (typeof source.commit === 'string' && source.commit.length < 7) {
          source.commit = '0000000'
        }
        // Fix empty ref fields
        if (typeof source.ref === 'string' && source.ref.length === 0) {
          source.ref = 'main'
        }
        // Fix empty uri fields
        if (typeof source.uri === 'string' && source.uri.length === 0) {
          // Can't reasonably guess a URI, remove the package
          delete packages[key]
        }
      }
    }
  }

  // Validate the repaired data
  const result = schema.safeParse(parsed)
  if (!result.success) {
    return null // Repair wasn't enough
  }

  writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n')
  return 'Repaired invalid fields'
}

function checkManifestIntegrity(projectRoot: string, scope: Scope): FixableDoctorCheck {
  const suffix = scope === 'global' ? '-global' : ''
  const name = `manifest-integrity${suffix}`
  const label = scopeLabel(scope)
  const manifestRoot =
    scope === 'global' ? join(homedir(), MANIFEST_DIR) : join(projectRoot, MANIFEST_DIR)
  const manifestPath = join(manifestRoot, MANIFEST_FILE)

  if (!existsSync(manifestPath)) {
    return check(name, 'warn', `Manifest file not found (no skills installed yet)${label}`, () => {
      writeEmptyManifest(manifestRoot)
      return 'Created empty manifest'
    })
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
    return check(name, 'fail', `Manifest contains invalid JSON${label}`, () => {
      writeEmptyManifest(manifestRoot)
      return 'Reset manifest (previous file had invalid JSON)'
    })
  }

  const result = manifestV2Schema.safeParse(parsed)
  if (!result.success) {
    return check(name, 'fail', `Manifest does not match expected schema${label}`, () => {
      return repairStorageFile(manifestPath, manifestV2Schema)
    })
  }

  return check(name, 'pass', `Manifest is valid${label}`)
}

function checkLockfileIntegrity(projectRoot: string, scope: Scope): FixableDoctorCheck {
  const suffix = scope === 'global' ? '-global' : ''
  const name = `lockfile-integrity${suffix}`
  const label = scopeLabel(scope)
  const lockfileRoot =
    scope === 'global' ? join(homedir(), MANIFEST_DIR) : join(projectRoot, MANIFEST_DIR)
  const lockfilePath = join(lockfileRoot, LOCKFILE_FILE)

  if (!existsSync(lockfilePath)) {
    return check(name, 'warn', `Lockfile not found (no skills installed yet)${label}`, () => {
      writeEmptyLockfile(lockfileRoot)
      return 'Created empty lockfile'
    })
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
    return check(name, 'fail', `Lockfile contains invalid JSON${label}`, () => {
      writeEmptyLockfile(lockfileRoot)
      return 'Reset lockfile (previous file had invalid JSON)'
    })
  }

  const result = lockfileV2Schema.safeParse(parsed)
  if (!result.success) {
    return check(name, 'fail', `Lockfile does not match expected schema${label}`, () => {
      return repairStorageFile(lockfilePath, lockfileV2Schema)
    })
  }

  return check(name, 'pass', `Lockfile is valid${label}`)
}

function checkManifestLockfileSync(projectRoot: string, scope: Scope): FixableDoctorCheck {
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
    return check(checkName, 'fail', `Out of sync — ${parts.join('; ')}${label}`, () => {
      const manifestRoot =
        scope === 'global' ? join(homedir(), MANIFEST_DIR) : join(projectRoot, MANIFEST_DIR)
      const manifestPath = join(manifestRoot, MANIFEST_FILE)
      const lockfilePath = join(manifestRoot, LOCKFILE_FILE)

      // Remove orphan entries from both sides to bring them in sync
      for (const name of inManifestOnly) {
        delete manifest.packages[name]
      }
      for (const name of inLockfileOnly) {
        delete lockfile.packages[name]
      }

      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
      writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2) + '\n')

      const removed = [...inManifestOnly, ...inLockfileOnly]
      return `Removed orphan entries: ${removed.join(', ')}`
    })
  }

  return check(checkName, 'pass', `Manifest and lockfile are in sync${label}`)
}

function checkSkillFilesExist(projectRoot: string, scope: Scope): DoctorCheck {
  const suffix = scope === 'global' ? '-global' : ''
  const checkName = `skill-files-exist${suffix}`
  const label = scopeLabel(scope)

  const manifest = readManifest(projectRoot, scope)
  const entries = Object.entries(manifest.packages)

  if (entries.length === 0) {
    return check(checkName, 'pass', `No packages installed${label}`)
  }

  const missing: string[] = []

  for (const [packageKey, pkg] of entries) {
    const displayName = getPackageDisplayName(packageKey, pkg)
    const shortName = displayName.split('/').pop() ?? displayName
    const canonicalPath = getCanonicalSkillPath(projectRoot, shortName, scope)
    if (!existsSync(canonicalPath) || !lstatSync(canonicalPath).isDirectory()) {
      missing.push(displayName)
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

  for (const [packageKey, pkg] of entries) {
    const displayName = getPackageDisplayName(packageKey, pkg)
    const shortName = displayName.split('/').pop() ?? displayName
    for (const agentId of pkg.agents) {
      const placementPath = getSkillPlacementPath(agentId as AgentId, shortName, scope)
      if (!placementPath) continue

      const agentSkillPath = resolvePlacementPath(placementPath, projectRoot, scope)
      if (!agentSkillPath) {
        broken.push(`${displayName}/${agentId} (invalid placement path)`)
        continue
      }

      if (!existsSync(agentSkillPath)) {
        broken.push(`${displayName}/${agentId}`)
        continue
      }

      try {
        const stats = lstatSync(agentSkillPath)
        if (stats.isSymbolicLink()) {
          const target = readlinkSync(agentSkillPath)
          const resolvedTarget = join(dirname(agentSkillPath), target)
          if (!existsSync(resolvedTarget)) {
            broken.push(`${displayName}/${agentId} (broken symlink)`)
          }
        }
      } catch {
        broken.push(`${displayName}/${agentId} (unreadable)`)
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
  const token = creds?.token
  const apiKey = creds?.apiKey
  const hasCredentials = !!(token ?? apiKey)

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

    const headers: Record<string, string> = {}
    if (token) {
      headers.Authorization = `Bearer ${token}`
    } else if (apiKey) {
      headers['X-API-Key'] = apiKey
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
    .option('--fix', 'Attempt to auto-fix issues that have known remedies')
    .action(async (options: { json?: boolean; fix?: boolean }) => {
      const jsonMode = isJSONMode() || options.json === true
      const fixMode = options.fix === true
      const projectRoot = process.cwd()

      const checks: FixableDoctorCheck[] = []

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

      // Run fixes for any failed/warned checks that have fix functions
      const fixResults: Array<{ name: string; result: string }> = []
      if (fixMode) {
        for (const c of checks) {
          if ((c.status === 'fail' || c.status === 'warn') && c.fix) {
            try {
              const result = c.fix()
              fixResults.push({ name: c.name, result })
              c.status = 'pass'
              c.message = `${c.message} → fixed: ${result}`
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              fixResults.push({ name: c.name, result: `FAILED: ${msg}` })
              c.message = `${c.message} → fix failed: ${msg}`
            }
          }
        }
      }

      const passed = checks.filter((c) => c.status === 'pass').length
      const failed = checks.filter((c) => c.status === 'fail').length
      const warnings = checks.filter((c) => c.status === 'warn').length

      if (jsonMode) {
        // Strip fix functions from JSON output
        const sanitized = checks.map(({ fix: _fix, ...rest }) => rest)
        const result: DoctorResult & { fixes?: typeof fixResults } = {
          checks: sanitized,
          passed,
          failed,
          warnings,
        }
        if (fixResults.length > 0) {
          result.fixes = fixResults
        }
        outputSuccess(result)
        process.exit(failed > 0 ? 1 : 0)
        return
      }

      console.log(chalk.bold('\nHealth checks:\n'))

      for (const result of checks) {
        console.log(formatCheck(result))
      }

      if (fixResults.length > 0) {
        console.log(chalk.bold('\nFixes applied:\n'))
        for (const fix of fixResults) {
          const icon = fix.result.startsWith('FAILED') ? chalk.red('✗') : chalk.green('✓')
          console.log(`  ${icon} ${fix.name}: ${fix.result}`)
        }
      } else if (fixMode && failed === 0 && warnings === 0) {
        console.log(chalk.dim('\nNothing to fix — all checks passed.'))
      } else if (!fixMode && failed > 0) {
        const fixableCount = checks.filter(
          (c) => (c.status === 'fail' || c.status === 'warn') && c.fix
        ).length
        if (fixableCount > 0) {
          console.log(
            chalk.dim(
              `\nTip: run ${chalk.bold('agentver doctor --fix')} to auto-repair ${String(fixableCount)} issue${fixableCount > 1 ? 's' : ''}`
            )
          )
        }
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
