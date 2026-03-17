'use client'

import { cn } from '@agentver/ui-utils'
import { Check, ExternalLink, GitBranch, Monitor, Package } from 'lucide-react'
import Link from 'next/link'
import { PACKAGE_TYPE_DISPLAY } from '@/lib/package-types'

type PackageData = {
  id: string
  slug: string
  name: string
  description: string | null
  type: string
  tags: string[]
  organisation: { slug: string; name: string }
  author: { name: string | null; image: string | null }
  versions: Array<{ version: string; gitRef?: string | null }>
  gitUri?: string | null
  gitPath?: string | null
  gitDefaultRef?: string
  _count: { installationReports: number }
}

type SkillListProps = {
  packages: PackageData[]
  selectable?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
}

function buildGitUrl(
  gitUri: string | null | undefined,
  gitPath: string | null | undefined
): string | null {
  if (!gitUri) return null
  const base = gitUri.startsWith('http') ? gitUri : `https://${gitUri}`
  if (gitPath) return `${base}/tree/HEAD/${gitPath}`
  return base
}

export function SkillList({ packages, selectable, selectedIds, onToggleSelect }: SkillListProps) {
  if (packages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-light text-primary">
          <Package className="size-5" />
        </div>
        <p className="mt-4 font-display font-medium text-lg">No packages yet</p>
        <p className="mt-1 max-w-sm text-muted-foreground text-sm">
          Register your first skill from a Git repository to get started.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border">
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-4 border-border border-b px-4 py-2.5 font-medium text-muted-foreground text-xs">
        <span>Name</span>
        <span className="w-24 text-center">Type</span>
        <span className="w-36 text-center">Git Source</span>
        <span className="w-20 text-right">Ref</span>
        <span className="w-24 text-right">Installations</span>
        <span className="w-20 text-right">Version</span>
      </div>
      {packages.map((pkg, index) => {
        const version = pkg.versions[0]?.version ?? '0.0.0'
        const gitRef = pkg.versions[0]?.gitRef ?? pkg.gitDefaultRef ?? 'main'
        const isSelected = selectedIds?.has(pkg.id) ?? false
        const gitUrl = buildGitUrl(pkg.gitUri, pkg.gitPath)

        return (
          <Link
            key={pkg.slug}
            href={`/skills/${pkg.organisation.slug}/${pkg.name}`}
            className={cn(
              'grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50',
              index < packages.length - 1 && 'border-border border-b',
              isSelected && 'bg-primary/5'
            )}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              {selectable && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onToggleSelect?.(pkg.id)
                  }}
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:border-muted-foreground/50'
                  )}
                >
                  {isSelected && <Check className="size-3" />}
                </button>
              )}
              <div className="min-w-0">
                <p className="truncate font-display font-medium text-sm">{pkg.name}</p>
                <p className="truncate text-muted-foreground text-xs">
                  {pkg.organisation.slug}
                  {pkg.description ? ` \u2014 ${pkg.description}` : ''}
                </p>
              </div>
            </div>
            <span
              className={cn(
                'w-24 rounded-full px-2.5 py-0.5 text-center font-medium text-xs',
                PACKAGE_TYPE_DISPLAY[pkg.type]?.colour ?? 'bg-secondary text-secondary-foreground'
              )}
            >
              {PACKAGE_TYPE_DISPLAY[pkg.type]?.label ?? pkg.type.toLowerCase()}
            </span>
            <span className="w-36 text-center">
              {pkg.gitUri ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                  <GitBranch className="size-3" />
                  <span className="max-w-[120px] truncate font-mono">{pkg.gitUri}</span>
                  {gitUrl && (
                    <ExternalLink
                      className="size-3 shrink-0"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        window.open(gitUrl, '_blank', 'noopener,noreferrer')
                      }}
                    />
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">&mdash;</span>
              )}
            </span>
            <span className="w-20 text-right font-mono text-muted-foreground text-xs">
              {gitRef}
            </span>
            <span className="flex w-24 items-center justify-end gap-1 text-muted-foreground text-xs">
              <Monitor className="size-3" />
              {pkg._count.installationReports}
            </span>
            <span className="w-20 text-right font-mono text-muted-foreground text-xs">
              v{version}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
