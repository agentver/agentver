import {
  createPackageKey,
  type GitSource,
  type LockfileV2,
  type ManifestV2,
  type PackageSource,
  type PlatformSource,
} from '@agentver/shared'
import type { PackageLookupResult } from './types'

type NamedPackage = Record<string, unknown> & { name?: string }

/** Extracts the display name from a manifest key and package entry. */
export function getDisplayName(manifestKey: string, pkg: NamedPackage): string {
  return pkg.name?.trim() || manifestKey
}

/** Resolves the display name of a bundle reference within a package set. */
export function resolveBundleDisplayName<T extends NamedPackage>(
  packages: Record<string, T>,
  bundleRef: string | undefined
): string | undefined {
  if (!bundleRef) {
    return undefined
  }

  const bundlePkg = packages[bundleRef]
  if (!bundlePkg) {
    return bundleRef
  }

  return getDisplayName(bundleRef, bundlePkg)
}

/** Creates a deterministic key from a display name and source. */
export function createStablePackageKey(displayName: string, source: PackageSource): string {
  return createPackageKey(displayName, source)
}

/** Finds a package by query (exact key, exact name, or short name). */
export function resolvePackageQuery<T extends NamedPackage>(
  packages: Record<string, T>,
  query: string
): PackageLookupResult<T> {
  if (query in packages) {
    const pkg = packages[query]!
    return { ok: true, key: query, displayName: getDisplayName(query, pkg), pkg }
  }

  const shortQuery = query.split('/').pop() ?? query
  const exactNameMatches = Object.entries(packages).filter(
    ([key, pkg]) => getDisplayName(key, pkg) === query
  )

  if (exactNameMatches.length === 1) {
    const [key, pkg] = exactNameMatches[0]!
    return { ok: true, key, displayName: getDisplayName(key, pkg), pkg }
  }

  if (exactNameMatches.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      matches: exactNameMatches.map(([key]) => key),
    }
  }

  const shortMatches = Object.entries(packages).filter(([key, pkg]) => {
    const name = getDisplayName(key, pkg)
    return name.split('/').pop() === shortQuery
  })

  if (shortMatches.length === 1) {
    const [key, pkg] = shortMatches[0]!
    return { ok: true, key, displayName: getDisplayName(key, pkg), pkg }
  }

  if (shortMatches.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      matches: shortMatches.map(([key]) => key),
    }
  }

  return { ok: false, reason: 'not-found', matches: [] }
}

/** Sets a manifest entry with correct key derivation. Returns the computed key. */
export function setManifestPackage(
  manifest: ManifestV2,
  displayName: string,
  entry: ManifestV2['packages'][string]
): string {
  const nextEntry = { ...entry, name: displayName }
  const key = createStablePackageKey(displayName, nextEntry.source)
  manifest.packages[key] = nextEntry
  return key
}

/** Sets a lockfile entry with correct key derivation. Returns the computed key. */
export function setLockfilePackage(
  lockfile: LockfileV2,
  displayName: string,
  entry: LockfileV2['packages'][string]
): string {
  const nextEntry = { ...entry, name: displayName }
  const key = createStablePackageKey(displayName, nextEntry.source)
  lockfile.packages[key] = nextEntry
  return key
}

/** Returns true for platform-managed sources (type 'platform' or type 'git' with agentver:// URI). */
export function isPlatformManagedSource(
  source: PackageSource
): source is PlatformSource | GitSource {
  return (
    source.type === 'platform' || (source.type === 'git' && source.uri.startsWith('agentver://'))
  )
}

/** Extracts the tracked ref from git/platform sources. Returns undefined for other types. */
export function getTrackedSourceRef(source: PackageSource): string | undefined {
  if (source.type === 'git' || source.type === 'platform') {
    return source.ref
  }

  return undefined
}

/** Extracts the tracked commit from git/platform sources. Returns undefined for other types. */
export function getTrackedSourceCommit(source: PackageSource): string | undefined {
  if (source.type === 'git' || source.type === 'platform') {
    return source.commit
  }

  return undefined
}

/** Converts a source to platform type with updated provenance fields. No-op for non-platform-managed sources. */
export function toPlatformSource(
  source: PackageSource,
  updates: Pick<PlatformSource, 'uri' | 'ref' | 'commit'>
): PackageSource {
  if (!isPlatformManagedSource(source)) {
    return source
  }

  return {
    type: 'platform',
    uri: updates.uri,
    path: source.path,
    ref: updates.ref,
    commit: updates.commit,
  }
}
