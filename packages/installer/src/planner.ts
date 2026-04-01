import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { detectInstalledAgents } from '@agentver/agent-definitions'
import type { LockfileV2, ManifestV2, PackageSource } from '@agentver/shared'
import { computeIntegrity, getDisplayName } from '@agentver/storage'
import {
  getCanonicalFilePath,
  getCanonicalSkillPath,
  getPlacementPathForCategory,
  resolveCanonicalCategory,
  resolvePlacementPath,
} from './canonical'
import { detectConflicts } from './conflict'
import type {
  CanonicalCategory,
  ConflictStrategy,
  DetectedConflict,
  InstallPlan,
  InstallRequest,
  InstallScope,
  LinkMode,
  PackageType,
  PlacementOperation,
  PlannedBackup,
  PlannedLinkMode,
  PlannedLockfileEntry,
  PlannedManifestEntry,
  RestoreEntry,
  RestorePlan,
  RestorePolicy,
  RestoreSkip,
  SourceClassification,
} from './types'

/**
 * Produces an install plan from a request.
 *
 * Resolves canonical paths, detects agents (if not explicitly provided),
 * checks for conflicts at each agent's placement path, determines link
 * mode viability, and builds the manifest/lockfile entries.
 *
 * The plan is always produced, even when it is not executable (e.g. due
 * to unresolved conflicts). The caller inspects `plan.executable` and
 * `plan.blockedReason` to decide whether to proceed.
 */
export function planInstall(request: InstallRequest): InstallPlan {
  const { displayName, packageType, files, target, policy, metadata } = request

  const category = resolveCanonicalCategory(packageType)
  const kind = metadata?.isUpdate ? 'update' : 'fresh'

  // 1. Resolve canonical target path
  const canonicalPath = resolveCanonicalPath(
    target.projectRoot,
    displayName,
    category,
    target.scope,
    metadata?.customPath
  )

  // 2. Auto-detect agents if not explicitly provided
  const agents = resolveAgents(target)

  // 3. Validate files for path traversal
  const { skippedFiles } = validateFiles(files, canonicalPath)

  // 4. Resolve per-agent placement paths and detect link mode
  const { placements, skippedAgents } = resolvePlacements(
    agents,
    displayName,
    category,
    target.scope,
    target.projectRoot,
    canonicalPath,
    policy.preferredLinkMode,
    metadata?.customPath
  )

  // 5. Detect conflicts at each placement path
  const conflicts = metadata?.customPath
    ? []
    : detectConflicts(
        target.projectRoot,
        displayName,
        agents,
        target.scope,
        category,
        canonicalPath
      )

  // 6. Apply conflict strategy to determine executability
  const { filteredPlacements, backupsRequired, executable, blockedReason } = applyConflictStrategy(
    placements,
    conflicts,
    policy.conflictStrategy,
    kind
  )

  // 7. Build manifest and lockfile entries
  const manifestEntry = buildManifestEntry(request, agents)
  const lockfileEntry = buildLockfileEntry(request, agents)

  return {
    request,
    kind,
    canonical: {
      path: canonicalPath,
      category,
    },
    placements: filteredPlacements,
    conflicts,
    backupsRequired,
    manifestEntry,
    lockfileEntry,
    skippedAgents,
    skippedFiles,
    executable,
    blockedReason,
  }
}

/**
 * Produces a restore plan from an existing manifest and lockfile.
 *
 * Classifies each manifest entry by source type, determines which
 * entries are restorable vs skippable, checks which are already
 * installed and up-to-date, and builds an ordered list of install
 * requests to execute.
 */
export function planRestore(
  manifest: ManifestV2,
  lockfile: LockfileV2,
  policy: RestorePolicy
): RestorePlan {
  const toInstall: RestoreEntry[] = []
  const upToDate: RestoreEntry[] = []
  const toSkip: RestoreSkip[] = []

  // Resolve agents
  const agents =
    policy.agents.length > 0
      ? policy.agents
      : detectInstalledAgents(policy.projectRoot).map((a) => a.id)

  for (const [key, manifestEntry] of Object.entries(manifest.packages)) {
    const displayName = getDisplayName(key, manifestEntry)
    const lockfileEntry = lockfile.packages[key]
    const classification = classifySource(manifestEntry.source)

    if (classification.kind === 'skip') {
      toSkip.push({ packageKey: key, displayName, reason: classification.reason })
      continue
    }

    // Skip bundles — their constituents are separate entries
    if (manifestEntry.packageType === 'BUNDLE') {
      toSkip.push({
        packageKey: key,
        displayName,
        reason: 'Bundle package — constituents are restored individually.',
      })
      continue
    }

    // Check for local modifications
    if (manifestEntry.modified && !policy.force) {
      toSkip.push({
        packageKey: key,
        displayName,
        reason: 'Package has local modifications — use --force to overwrite.',
      })
      continue
    }

    const entry: RestoreEntry = {
      packageKey: key,
      displayName,
      manifestEntry,
      lockfileEntry,
      fetchStrategy: classification.fetchStrategy,
      alreadyInstalled: false,
    }

    // Check if already installed and up-to-date
    if (!policy.force && isUpToDate(entry, policy)) {
      entry.alreadyInstalled = true
      upToDate.push(entry)
      continue
    }

    toInstall.push(entry)
  }

  // Topologically sort by dependsOn
  const sorted = topologicalSort(toInstall)

  return {
    toInstall: sorted,
    upToDate,
    toSkip,
    agents,
    policy,
  }
}

/**
 * Classifies a package source for restore eligibility.
 */
export function classifySource(source: PackageSource): SourceClassification {
  switch (source.type) {
    case 'git':
      return { kind: 'restorable', fetchStrategy: 'git' }
    case 'platform':
      return { kind: 'restorable', fetchStrategy: 'platform' }
    case 'well-known':
      return { kind: 'restorable', fetchStrategy: 'well-known' }
    case 'local':
      return {
        kind: 'skip',
        reason: 'Local package — run agentver promote or re-install from a remote source.',
      }
    case 'unknown':
      return {
        kind: 'skip',
        reason: 'Unknown source origin — re-install from the original source.',
      }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveCanonicalPath(
  projectRoot: string,
  name: string,
  category: CanonicalCategory,
  scope: InstallScope,
  customPath?: string
): string {
  if (customPath) {
    const resolved = resolve(projectRoot, customPath)
    if (!resolved.startsWith(`${resolve(projectRoot)}/`) && resolved !== resolve(projectRoot)) {
      throw new Error(`Custom path escapes project root: ${customPath}`)
    }
    return resolved
  }

  if (category === 'skills') {
    return getCanonicalSkillPath(projectRoot, name, scope)
  }
  return getCanonicalFilePath(projectRoot, name, category, scope)
}

function resolveAgents(target: {
  agents: string[]
  projectRoot: string
  scope: InstallScope
}): string[] {
  if (target.agents.length > 0) return target.agents

  const detected = detectInstalledAgents(target.projectRoot)

  return detected.map((a) => a.id)
}

function validateFiles(
  files: Array<{ path: string; content: string }>,
  canonicalPath: string
): {
  skippedFiles: Array<{ path: string; reason: string }>
} {
  const skippedFiles: Array<{ path: string; reason: string }> = []

  for (const file of files) {
    if (file.path.includes('..')) {
      skippedFiles.push({ path: file.path, reason: 'Path traversal detected (..)' })
      continue
    }

    if (file.path.startsWith('/')) {
      skippedFiles.push({ path: file.path, reason: 'Absolute path not allowed' })
      continue
    }

    const resolvedFilePath = resolve(canonicalPath, file.path)
    if (
      !resolvedFilePath.startsWith(`${resolve(canonicalPath)}/`) &&
      resolvedFilePath !== resolve(canonicalPath)
    ) {
      skippedFiles.push({ path: file.path, reason: 'Resolved path escapes canonical directory' })
    }
  }

  return { skippedFiles }
}

function resolvePlacements(
  agents: string[],
  name: string,
  category: CanonicalCategory,
  scope: InstallScope,
  projectRoot: string,
  _canonicalPath: string,
  preferredLinkMode: LinkMode,
  customPath?: string
): {
  placements: PlacementOperation[]
  skippedAgents: Array<{ agentId: string; reason: string }>
} {
  // Custom path installs have no agent placements
  if (customPath) {
    return { placements: [], skippedAgents: [] }
  }

  const placements: PlacementOperation[] = []
  const skippedAgents: Array<{ agentId: string; reason: string }> = []

  for (const agentId of agents) {
    const placementPath = getPlacementPathForCategory(agentId, name, category, scope)
    if (!placementPath) {
      skippedAgents.push({
        agentId,
        reason: `Agent does not support ${category} placements`,
      })
      continue
    }

    const fullPath = resolvePlacementPath(placementPath, projectRoot, scope)
    if (!fullPath) {
      skippedAgents.push({
        agentId,
        reason: 'Placement path could not be resolved safely',
      })
      continue
    }

    const linkMode: PlannedLinkMode = {
      mode: preferredLinkMode,
      isFallback: false,
    }

    placements.push({
      agentId,
      destinationPath: fullPath,
      linkMode,
    })
  }

  return { placements, skippedAgents }
}

function applyConflictStrategy(
  placements: PlacementOperation[],
  conflicts: DetectedConflict[],
  strategy: ConflictStrategy,
  kind: 'fresh' | 'update'
): {
  filteredPlacements: PlacementOperation[]
  backupsRequired: PlannedBackup[]
  executable: boolean
  blockedReason?: string
} {
  if (conflicts.length === 0) {
    return {
      filteredPlacements: placements,
      backupsRequired: [],
      executable: true,
    }
  }

  const conflictPaths = new Set(conflicts.map((c) => c.path))
  const backupsRequired: PlannedBackup[] = []

  switch (strategy) {
    case 'error':
      return {
        filteredPlacements: placements,
        backupsRequired: [],
        executable: false,
        blockedReason: `Conflicts detected at ${conflicts.length} placement path(s). Use a different conflict strategy to proceed.`,
      }

    case 'backup-and-replace':
      for (const conflict of conflicts) {
        backupsRequired.push({
          originalPath: conflict.path,
          reason: kind === 'update' ? 'update-replace' : 'conflict-replace',
        })
      }
      return {
        filteredPlacements: placements,
        backupsRequired,
        executable: true,
      }

    case 'skip':
      return {
        filteredPlacements: placements.filter((p) => !conflictPaths.has(p.destinationPath)),
        backupsRequired: [],
        executable: true,
      }

    case 'force':
      return {
        filteredPlacements: placements,
        backupsRequired: [],
        executable: true,
      }
  }
}

function buildManifestEntry(request: InstallRequest, agents: string[]): PlannedManifestEntry {
  const entry: PlannedManifestEntry = {
    name: request.displayName,
    source: request.source,
    agents,
    installedAt: new Date().toISOString(),
    modified: false,
    packageType: request.packageType,
  }

  if (request.metadata?.customPath) {
    entry.path = request.metadata.customPath
  }

  if (request.metadata?.bundleParentKey) {
    entry.bundle = request.metadata.bundleParentKey
  }

  if (request.metadata?.entryFile) {
    entry.entryFile = request.metadata.entryFile
  }

  if (request.metadata?.dependsOn && request.metadata.dependsOn.length > 0) {
    entry.dependsOn = request.metadata.dependsOn
  }

  if (request.metadata?.conflictsWith && request.metadata.conflictsWith.length > 0) {
    entry.conflictsWith = request.metadata.conflictsWith
  }

  return entry
}

function buildLockfileEntry(request: InstallRequest, agents: string[]): PlannedLockfileEntry {
  return {
    name: request.displayName,
    source: request.source,
    integrity: request.integrity,
    agents,
  }
}

/**
 * Checks whether a restore entry is already installed and up-to-date
 * by comparing on-disc files against the lockfile integrity hash.
 */
function isUpToDate(entry: RestoreEntry, policy: RestorePolicy): boolean {
  const { manifestEntry, lockfileEntry, displayName } = entry

  if (!lockfileEntry?.integrity) return false

  const packageType = manifestEntry.packageType ?? 'SKILL'
  const category = resolveCanonicalCategory(packageType as PackageType)

  if (packageType === 'BUNDLE') return false

  if (category === 'skills') {
    const canonicalPath = getCanonicalSkillPath(policy.projectRoot, displayName, policy.scope)
    if (!existsSync(canonicalPath) || !lstatSync(canonicalPath).isDirectory()) return false

    const discFiles = readDirectoryFiles(canonicalPath, canonicalPath)
    if (discFiles.length === 0) return false

    const discIntegrity = computeIntegrity(discFiles)
    return discIntegrity === lockfileEntry.integrity
  }

  const canonicalPath = getCanonicalFilePath(
    policy.projectRoot,
    displayName,
    category,
    policy.scope
  )
  if (!existsSync(canonicalPath) || !lstatSync(canonicalPath).isFile()) return false

  const content = readFileSync(canonicalPath, 'utf-8')
  const discIntegrity = computeIntegrity([{ path: `${displayName}.md`, content }])
  return discIntegrity === lockfileEntry.integrity
}

/**
 * Reads all files from a directory, returning relative paths and content.
 */
function readDirectoryFiles(
  dirPath: string,
  basePath: string
): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = []

  const entries = readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...readDirectoryFiles(fullPath, basePath))
    } else if (entry.isFile()) {
      const relativePath = fullPath.slice(basePath.length + 1)
      const content = readFileSync(fullPath, 'utf-8')
      files.push({ path: relativePath, content })
    }
  }

  return files
}

/**
 * Topologically sorts restore entries based on their dependsOn fields.
 * Falls back to insertion order on cycle detection.
 */
function topologicalSort(entries: RestoreEntry[]): RestoreEntry[] {
  const keyMap = new Map<string, RestoreEntry>()
  for (const entry of entries) {
    keyMap.set(entry.packageKey, entry)
  }

  const visited = new Set<string>()
  const visiting = new Set<string>()
  const sorted: RestoreEntry[] = []
  let hasCycle = false

  function visit(key: string): void {
    if (visited.has(key)) return
    if (visiting.has(key)) {
      hasCycle = true
      return
    }

    visiting.add(key)

    const entry = keyMap.get(key)
    if (entry?.manifestEntry.dependsOn) {
      for (const dep of entry.manifestEntry.dependsOn) {
        if (keyMap.has(dep)) {
          visit(dep)
        }
      }
    }

    visiting.delete(key)
    visited.add(key)

    if (entry) {
      sorted.push(entry)
    }
  }

  for (const entry of entries) {
    visit(entry.packageKey)
  }

  if (hasCycle) {
    return entries
  }

  return sorted
}
