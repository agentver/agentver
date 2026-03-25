import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ManifestV2 } from '@agentver/shared'
import { manifestAnySchema, manifestV2Schema } from '@agentver/shared'
import type { Scope } from '../utils/paths'
import { createCliLogger } from '../utils.js'
import { serialiseDeterministic } from './serialise'

const logger = createCliLogger('manifest')

const MANIFEST_DIR = '.agentver'
const MANIFEST_FILE = 'manifest.json'

function getManifestRoot(projectRoot: string, scope: Scope): string {
  if (scope === 'global') {
    return join(homedir(), MANIFEST_DIR)
  }
  return join(projectRoot, MANIFEST_DIR)
}

function getManifestPath(projectRoot: string, scope: Scope = 'project'): string {
  return join(getManifestRoot(projectRoot, scope), MANIFEST_FILE)
}

function migrateV1ToV2(v1: {
  version: 1
  packages: Record<string, { name: string; version: string; agents: string[]; installedAt: string }>
}): ManifestV2 {
  const packages: ManifestV2['packages'] = {}

  for (const [name, pkg] of Object.entries(v1.packages)) {
    packages[name] = {
      source: {
        type: 'git',
        uri: 'unknown',
        path: '',
        ref: 'unknown',
        commit: 'unknown',
      },
      agents: pkg.agents,
      installedAt: pkg.installedAt,
      modified: false,
    }
  }

  return { version: 2, packages }
}

export function readManifest(projectRoot: string, scope: Scope = 'project'): ManifestV2 {
  const manifestPath = getManifestPath(projectRoot, scope)

  if (!existsSync(manifestPath)) {
    return { version: 2, packages: {} }
  }

  const raw = readFileSync(manifestPath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    logger.warn(`Corrupt manifest at ${manifestPath} — could not parse JSON. Using empty manifest.`)
    return { version: 2, packages: {} }
  }

  const result = manifestAnySchema.safeParse(parsed)
  if (!result.success) {
    logger.warn(
      `Invalid manifest at ${manifestPath} — schema validation failed. Using empty manifest.`
    )
    return { version: 2, packages: {} }
  }

  if (result.data.version === 1) {
    const migrated = migrateV1ToV2(result.data)
    writeManifest(projectRoot, migrated, scope)
    return migrated
  }

  return result.data
}

export function writeManifest(
  projectRoot: string,
  manifest: ManifestV2,
  scope: Scope = 'project'
): void {
  manifestV2Schema.parse(manifest)

  const dir = getManifestRoot(projectRoot, scope)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const filePath = getManifestPath(projectRoot, scope)
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, serialiseDeterministic(manifest))
  renameSync(tmpPath, filePath)
}
