import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LockfileV2 } from '@agentver/shared'
import { lockfileAnySchema } from '@agentver/shared'
import { serialiseDeterministic } from './serialise'

const LOCKFILE_DIR = '.agentver'
const LOCKFILE_FILE = 'lockfile.json'

const EMPTY_LOCKFILE: LockfileV2 = { version: 2, packages: {} }

function getLockfilePath(projectRoot: string): string {
  return join(projectRoot, LOCKFILE_DIR, LOCKFILE_FILE)
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

export function readLockfile(projectRoot: string): LockfileV2 {
  const lockfilePath = getLockfilePath(projectRoot)

  if (!existsSync(lockfilePath)) {
    return EMPTY_LOCKFILE
  }

  const raw = readFileSync(lockfilePath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return EMPTY_LOCKFILE
  }

  const result = lockfileAnySchema.safeParse(parsed)
  if (!result.success) {
    return EMPTY_LOCKFILE
  }

  if (result.data.version === 1) {
    const migrated = migrateV1ToV2(result.data)
    writeLockfile(projectRoot, migrated)
    return migrated
  }

  return result.data
}

export function writeLockfile(projectRoot: string, lockfile: LockfileV2): void {
  const dir = join(projectRoot, LOCKFILE_DIR)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const filePath = getLockfilePath(projectRoot)
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, serialiseDeterministic(lockfile))
  renameSync(tmpPath, filePath)
}
