import type {
  GitSource,
  LockfileV2,
  ManifestV2,
  PackageSource,
  PlatformSource,
} from '@agentver/shared'

type NamedPackage = Record<string, unknown> & { name?: string }

export type PackageLookupSuccess<T> = {
  ok: true
  key: string
  displayName: string
  pkg: T
}

export type PackageLookupFailure = {
  ok: false
  reason: 'not-found' | 'ambiguous'
  matches: string[]
}

export type PackageLookupResult<T> = PackageLookupSuccess<T> | PackageLookupFailure

export function getDisplayName(manifestKey: string, pkg: NamedPackage): string {
  return pkg.name?.trim() || manifestKey
}

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

export function createStablePackageKey(
  displayName: string,
  source: ManifestV2['packages'][string]['source']
): string {
  const identity = (() => {
    switch (source.type) {
      case 'git':
        return `${source.uri}#${source.path}`
      case 'platform':
        return `${source.uri}#${source.path}`
      case 'well-known':
        return `${source.baseUrl}#${source.skillName}`
      case 'local':
        return source.path
      case 'unknown':
        return [source.path ?? '', source.ref ?? '', source.commit ?? '', displayName].join('#')
    }
  })()

  return `${source.type}:${encodeURIComponent(identity)}`
}

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
    const displayName = getDisplayName(key, pkg)
    return displayName.split('/').pop() === shortQuery
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

export function isPlatformManagedSource(
  source: PackageSource
): source is PlatformSource | GitSource {
  return (
    source.type === 'platform' || (source.type === 'git' && source.uri.startsWith('agentver://'))
  )
}

export function getTrackedSourceRef(source: PackageSource): string | undefined {
  if (source.type === 'git' || source.type === 'platform') {
    return source.ref
  }

  return undefined
}

export function getTrackedSourceCommit(source: PackageSource): string | undefined {
  if (source.type === 'git' || source.type === 'platform') {
    return source.commit
  }

  return undefined
}

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
