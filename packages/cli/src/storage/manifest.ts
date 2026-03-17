import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ManifestV2 } from '@agentver/shared'
import { manifestAnySchema } from '@agentver/shared'
import { serialiseDeterministic } from './serialise'

const MANIFEST_DIR = '.agentver'
const MANIFEST_FILE = 'manifest.json'

const EMPTY_MANIFEST: ManifestV2 = { version: 2, packages: {} }

function getManifestPath(projectRoot: string): string {
  return join(projectRoot, MANIFEST_DIR, MANIFEST_FILE)
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

export function readManifest(projectRoot: string): ManifestV2 {
  const manifestPath = getManifestPath(projectRoot)

  if (!existsSync(manifestPath)) {
    return EMPTY_MANIFEST
  }

  const raw = readFileSync(manifestPath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return EMPTY_MANIFEST
  }

  const result = manifestAnySchema.safeParse(parsed)
  if (!result.success) {
    return EMPTY_MANIFEST
  }

  if (result.data.version === 1) {
    const migrated = migrateV1ToV2(result.data)
    writeManifest(projectRoot, migrated)
    return migrated
  }

  return result.data
}

export function writeManifest(projectRoot: string, manifest: ManifestV2): void {
  const dir = join(projectRoot, MANIFEST_DIR)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const filePath = getManifestPath(projectRoot)
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, serialiseDeterministic(manifest))
  renameSync(tmpPath, filePath)
}
