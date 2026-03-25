import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LockfileV2 } from '@agentver/shared'
import { lockfileAnySchema, lockfileV2Schema } from '@agentver/shared'
import type { Scope } from '../utils/paths'
import { createCliLogger } from '../utils.js'
import { serialiseDeterministic } from './serialise'

const logger = createCliLogger('lockfile')

const LOCKFILE_DIR = '.agentver'
const LOCKFILE_FILE = 'lockfile.json'

function getLockfileRoot(projectRoot: string, scope: Scope): string {
  if (scope === 'global') {
    return join(homedir(), LOCKFILE_DIR)
  }
  return join(projectRoot, LOCKFILE_DIR)
}

function getLockfilePath(projectRoot: string, scope: Scope = 'project'): string {
  return join(getLockfileRoot(projectRoot, scope), LOCKFILE_FILE)
}

function migrateV1ToV2(v1: {
  version: 1
  packages: Record<
    string,
    { version: string; resolved: string; integrity: string; agents: string[] }
  >
}): LockfileV2 {
  const packages: LockfileV2['packages'] = {}

  for (const [name, pkg] of Object.entries(v1.packages)) {
    packages[name] = {
      source: {
        type: 'git',
        uri: 'unknown',
        path: '',
        ref: 'unknown',
        commit: 'unknown',
      },
      integrity: pkg.integrity,
      agents: pkg.agents,
    }
  }

  return { version: 2, packages }
}

export function readLockfile(projectRoot: string, scope: Scope = 'project'): LockfileV2 {
  const lockfilePath = getLockfilePath(projectRoot, scope)

  if (!existsSync(lockfilePath)) {
    return { version: 2, packages: {} }
  }

  const raw = readFileSync(lockfilePath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    logger.warn(`Corrupt lockfile at ${lockfilePath} — could not parse JSON. Using empty lockfile.`)
    return { version: 2, packages: {} }
  }

  const result = lockfileAnySchema.safeParse(parsed)
  if (!result.success) {
    logger.warn(
      `Invalid lockfile at ${lockfilePath} — schema validation failed. Using empty lockfile.`
    )
    return { version: 2, packages: {} }
  }

  if (result.data.version === 1) {
    const migrated = migrateV1ToV2(result.data)
    writeLockfile(projectRoot, migrated, scope)
    return migrated
  }

  return result.data
}

export function writeLockfile(
  projectRoot: string,
  lockfile: LockfileV2,
  scope: Scope = 'project'
): void {
  lockfileV2Schema.parse(lockfile)

  const dir = getLockfileRoot(projectRoot, scope)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const filePath = getLockfilePath(projectRoot, scope)
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, serialiseDeterministic(lockfile))
  renameSync(tmpPath, filePath)
}
